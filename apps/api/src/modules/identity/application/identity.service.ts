import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { LoginInput, Me, MfaSetup, RegisterInput, Role } from '@soscomida/contracts';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../../../infra/config/config';
import { DB, type Database, isUniqueViolation } from '../../../infra/db/db';
import { DomainError, conflict, notFound } from '../../../infra/http/errors';
import { newId } from '../../../infra/ids';
import { AuditService } from '../../audit';
import type { AuthContext } from '../domain/auth-context';
import {
  decryptSecret,
  dummyPasswordHash,
  encryptSecret,
  hashPassword,
  newSessionToken,
  sha256,
  verifyPassword,
} from '../domain/credentials';
import { newTotpSecret, totpUri, verifyTotp } from '../domain/totp';
import { sessions, userRoles, users } from '../infra/identity.schema';

const DAY_MS = 24 * 3600 * 1000;
/** A sessão só é "tocada" (renovada) uma vez por hora, para não escrever no banco a cada requisição. */
const TOUCH_INTERVAL_MS = 3600 * 1000;
const MAX_FAILED_LOGINS = 10;
const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

const invalidCredentials = () =>
  new DomainError('INVALID_CREDENTIALS', 'E-mail ou senha incorretos', HttpStatus.UNAUTHORIZED);

@Injectable()
export class IdentityService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  async register(input: RegisterInput, meta: RequestMeta): Promise<IssuedSession> {
    const id = newId();
    const passwordHash = await hashPassword(input.password);
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(users).values({ id, email: input.email, name: input.name, passwordHash });
        await this.audit.record({ actorUserId: id, action: 'auth.registered', targetType: 'user', targetId: id, ...meta }, tx);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'users_email_key')) {
        throw conflict('EMAIL_IN_USE', 'Já existe uma conta com este e-mail');
      }
      throw error;
    }
    return this.createSession(id, false, meta);
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<IssuedSession> {
    const emailHash = sha256(input.email);
    if (await this.tooManyFailures(emailHash)) {
      throw new DomainError('TOO_MANY_ATTEMPTS', 'Muitas tentativas. Tente de novo em 15 minutos.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const [user] = await this.db.select().from(users).where(eq(users.email, input.email)).limit(1);
    const ok = await verifyPassword(user?.passwordHash ?? (await dummyPasswordHash()), input.password);

    if (!user || !ok || user.disabledAt) {
      // Alvo é o hash do e-mail: conta tentativas sem gravar o e-mail na auditoria.
      await this.audit.record({ actorUserId: user?.id ?? null, action: 'auth.login_failed', targetType: 'email', targetId: emailHash, ...meta });
      throw invalidCredentials();
    }

    await this.audit.record({ actorUserId: user.id, action: 'auth.login', targetType: 'user', targetId: user.id, ...meta });
    return this.createSession(user.id, false, meta);
  }

  /** Resolve o token do cookie. Devolve `null` para sessão inexistente, expirada, revogada ou conta desativada. */
  async resolveSession(token: string): Promise<AuthContext | null> {
    const agora = new Date();
    const [linha] = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, agora), isNull(users.disabledAt)))
      .limit(1);
    if (!linha) return null;

    const { session, user } = linha;
    if (agora.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      const novaExpiracao = new Date(Math.min(agora.getTime() + this.config.SESSION_TTL_DAYS * DAY_MS, session.absoluteExpiresAt.getTime()));
      await this.db.update(sessions).set({ lastSeenAt: agora, expiresAt: novaExpiracao }).where(eq(sessions.id, session.id));
    }

    const roles = await this.db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, user.id));
    return {
      userId: user.id,
      sessionId: session.id,
      name: user.name,
      email: user.email,
      roles: roles.map((r) => r.role as Role),
      mfaEnabled: user.mfaEnabledAt !== null,
      mfaVerified: session.mfaVerified,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
  }

  async logoutAll(userId: string, meta: RequestMeta): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
      await this.audit.record({ actorUserId: userId, action: 'auth.logout_all', targetType: 'user', targetId: userId, ...meta }, tx);
    });
  }

  me(auth: AuthContext): Me {
    return {
      id: auth.userId,
      name: auth.name,
      email: auth.email,
      roles: auth.roles,
      mfaEnabled: auth.mfaEnabled,
      mfaVerified: auth.mfaVerified,
    };
  }

  /** Gera um segredo novo. Só passa a valer depois de confirmado com um código (enableMfa). */
  async setupMfa(auth: AuthContext): Promise<MfaSetup> {
    if (auth.mfaEnabled) throw conflict('MFA_ALREADY_ENABLED', 'O MFA já está ativo nesta conta');
    const secret = newTotpSecret();
    await this.db
      .update(users)
      .set({ mfaSecretEnc: encryptSecret(secret, this.config.MFA_ENCRYPTION_KEY), updatedAt: new Date() })
      .where(eq(users.id, auth.userId));
    return { secret, otpauthUri: totpUri(secret, this.config.MFA_ISSUER, auth.email) };
  }

  async enableMfa(auth: AuthContext, code: string, meta: RequestMeta): Promise<void> {
    const secret = await this.loadMfaSecret(auth.userId);
    if (!secret || !verifyTotp(secret, code)) throw new DomainError('INVALID_MFA_CODE', 'Código inválido');
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ mfaEnabledAt: new Date(), updatedAt: new Date() }).where(eq(users.id, auth.userId));
      await tx.update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, auth.sessionId));
      await this.audit.record({ actorUserId: auth.userId, action: 'auth.mfa_enabled', targetType: 'user', targetId: auth.userId, ...meta }, tx);
    });
  }

  /**
   * Confirma o segundo fator nesta sessão e troca o token (a sessão ganha
   * privilégio; token novo evita fixação de sessão).
   */
  async verifyMfa(auth: AuthContext, code: string, meta: RequestMeta): Promise<IssuedSession> {
    const secret = auth.mfaEnabled ? await this.loadMfaSecret(auth.userId) : null;
    if (!secret || !verifyTotp(secret, code)) {
      await this.audit.record({ actorUserId: auth.userId, action: 'auth.mfa_failed', targetType: 'user', targetId: auth.userId, ...meta });
      throw new DomainError('INVALID_MFA_CODE', 'Código inválido');
    }
    await this.logout(auth.sessionId);
    await this.audit.record({ actorUserId: auth.userId, action: 'auth.mfa_verified', targetType: 'user', targetId: auth.userId, ...meta });
    return this.createSession(auth.userId, true, meta);
  }

  /** Nomes públicos de usuários (para exibir organizador, moderador). */
  async displayNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const linhas = await this.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
    return new Map(linhas.map((l) => [l.id, l.name]));
  }

  /** Para quem mandar avisos por e-mail. Contas desativadas ficam de fora. */
  async contacts(ids: string[]): Promise<Map<string, { name: string; email: string }>> {
    if (ids.length === 0) return new Map();
    const linhas = await this.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(and(inArray(users.id, ids), isNull(users.disabledAt)));
    return new Map(linhas.map((l) => [l.id, { name: l.name, email: l.email }]));
  }

  async revokeRole(userId: string, role: Role, revokedBy: string): Promise<void> {
    if (userId === revokedBy && role === 'admin') {
      throw conflict('CANNOT_REVOKE_OWN_ADMIN', 'Você não pode remover o próprio papel de administrador');
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.role, role)));
      await this.audit.record({ actorUserId: revokedBy, action: 'user.role_revoked', targetType: 'user', targetId: userId, metadata: { role } }, tx);
    });
  }

  async findUserIdByEmail(email: string): Promise<string | null> {
    const [user] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
    return user?.id ?? null;
  }

  async grantRole(userId: string, role: Role, grantedBy: string | null): Promise<void> {
    const [existe] = await this.db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!existe) throw notFound('Usuário');
    await this.db.transaction(async (tx) => {
      await tx.insert(userRoles).values({ userId, role, grantedBy }).onConflictDoNothing();
      await this.audit.record({ actorUserId: grantedBy, action: 'user.role_granted', targetType: 'user', targetId: userId, metadata: { role } }, tx);
    });
  }

  private async createSession(userId: string, mfaVerified: boolean, meta: RequestMeta): Promise<IssuedSession> {
    const { token, tokenHash } = newSessionToken();
    const agora = Date.now();
    const absoluteExpiresAt = new Date(agora + this.config.SESSION_ABSOLUTE_DAYS * DAY_MS);
    const expiresAt = new Date(Math.min(agora + this.config.SESSION_TTL_DAYS * DAY_MS, absoluteExpiresAt.getTime()));
    await this.db.insert(sessions).values({
      id: newId(),
      userId,
      tokenHash,
      mfaVerified,
      expiresAt,
      absoluteExpiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    });
    return { token, expiresAt };
  }

  private async loadMfaSecret(userId: string): Promise<string | null> {
    const [user] = await this.db.select({ enc: users.mfaSecretEnc }).from(users).where(eq(users.id, userId)).limit(1);
    return user?.enc ? decryptSecret(user.enc, this.config.MFA_ENCRYPTION_KEY) : null;
  }

  private async tooManyFailures(emailHash: string): Promise<boolean> {
    const desde = new Date(Date.now() - FAILED_LOGIN_WINDOW_MS);
    const total = await this.audit.countSince({ action: 'auth.login_failed', targetType: 'email', targetId: emailHash }, desde);
    return total >= MAX_FAILED_LOGINS;
  }

}


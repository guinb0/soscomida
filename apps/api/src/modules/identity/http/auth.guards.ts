import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@soscomida/contracts';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../../../infra/config/config';
import { IS_PUBLIC } from '../../../infra/http/decorators';
import { DomainError, forbidden } from '../../../infra/http/errors';
import { IdentityService } from '../application/identity.service';
import { type AuthContext, ELEVATED_ROLES } from '../domain/auth-context';

export type AuthenticatedRequest = Request & { auth?: AuthContext };

const ROLES_KEY = 'roles';

/** Exige ao menos um dos papéis. Papéis elevados também exigem MFA verificado na sessão. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Usuário da sessão. Em rotas `@Public()` pode ser `undefined`. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext | undefined => {
  return ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth;
});

export function sessionTokenFrom(request: Request, cookieName: string): string | undefined {
  const cookies = request.cookies as Record<string, string> | undefined;
  const cookie = cookies?.[cookieName];
  if (cookie) return cookie;
  const header = request.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

/**
 * Guard global: resolve a sessão (cookie ou Bearer) e nega por padrão.
 * Rotas `@Public()` passam, mas recebem o usuário se houver sessão.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly identity: IdentityService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = sessionTokenFrom(request, this.config.sessionCookieName);
    if (token) request.auth = (await this.identity.resolveSession(token)) ?? undefined;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    if (!request.auth) throw new UnauthorizedException('Faça login para continuar');
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;

    const auth = context.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    if (!auth) throw new UnauthorizedException('Faça login para continuar');
    if (!required.some((r) => auth.roles.includes(r))) throw forbidden();

    const exigeMfa = required.some((r) => ELEVATED_ROLES.includes(r));
    if (exigeMfa && !auth.mfaVerified) {
      throw new DomainError(
        auth.mfaEnabled ? 'MFA_REQUIRED' : 'MFA_SETUP_REQUIRED',
        auth.mfaEnabled ? 'Confirme o código do autenticador para continuar' : 'Configure a verificação em duas etapas para usar esta área',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}

/** Dados da requisição usados na auditoria. */
export const RequestMetaParam = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<Request & { id?: string }>();
  return {
    ip: request.ip ?? null,
    userAgent: request.headers['user-agent'] ?? null,
    requestId: typeof request.id === 'string' ? request.id : null,
  };
});

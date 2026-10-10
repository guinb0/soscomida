import type { Role } from '@soscomida/contracts';

/** Quem está fazendo a requisição. Sempre vem da sessão, nunca do corpo. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  name: string;
  email: string;
  roles: Role[];
  mfaEnabled: boolean;
  mfaVerified: boolean;
}

export const hasRole = (auth: AuthContext | undefined, ...roles: Role[]): boolean =>
  !!auth && roles.some((r) => auth.roles.includes(r));

/** Papéis que exigem MFA verificado na sessão para agir. */
export const ELEVATED_ROLES: readonly Role[] = ['moderator', 'admin', 'auditor'];

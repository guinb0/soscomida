import { z } from 'zod';

export const ROLES = ['moderator', 'admin', 'auditor'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

const emailSchema = z.email('E-mail inválido').max(254).transform((e) => e.trim().toLowerCase());

export const registerInputSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome').max(120),
  email: emailSchema,
  password: z.string().min(10, 'A senha precisa de pelo menos 10 caracteres').max(200),
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const mfaCodeInputSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Código de 6 dígitos'),
});
export type MfaCodeInput = z.infer<typeof mfaCodeInputSchema>;

export const meSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  roles: z.array(roleSchema),
  mfaEnabled: z.boolean(),
  /** MFA confirmado nesta sessão. Papéis elevados exigem `true`. */
  mfaVerified: z.boolean(),
});
export type Me = z.infer<typeof meSchema>;

/** Sessão atual sem erro para visitantes: `user` nulo quando não há login. */
export const sessionSchema = z.object({ user: meSchema.nullable() });
export type Session = z.infer<typeof sessionSchema>;

export const mfaSetupSchema = z.object({
  /** URI otpauth:// para o app autenticador (QR Code no front). */
  otpauthUri: z.string(),
  secret: z.string(),
});
export type MfaSetup = z.infer<typeof mfaSetupSchema>;

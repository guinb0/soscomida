import { z } from 'zod';

const booleanFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const csv = z
  .string()
  .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    /** Origens do front aceitas em requisições que alteram estado (proteção CSRF). */
    APP_ORIGINS: csv.default(['http://localhost:3000']),
    PUBLIC_WEB_URL: z.url().default('http://localhost:3000'),

    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().default(10),
    REDIS_URL: z.string().min(1),

    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
    SESSION_ABSOLUTE_DAYS: z.coerce.number().int().positive().default(30),
    /** 32 bytes em base64: cifra os segredos TOTP (AES-256-GCM). */
    MFA_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'MFA_ENCRYPTION_KEY precisa ter 32 bytes em base64'),
    MFA_ISSUER: z.string().default('SOS Comida'),

    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: booleanFromEnv,
    S3_PRIVATE_BUCKET: z.string().default('soscomida-private'),
    S3_PUBLIC_BUCKET: z.string().default('soscomida-public'),
    /** URL pública do bucket público (CDN em produção). */
    S3_PUBLIC_BASE_URL: z.url(),

    PAYMENTS_PROVIDER: z.enum(['dev', 'asaas']).default('dev'),
    ASAAS_BASE_URL: z.url().optional(),
    ASAAS_API_KEY: z.string().optional(),
    ASAAS_WEBHOOK_TOKEN: z.string().optional(),
    /**
     * Só `true` depois de validar o adaptador contra o sandbox do Asaas
     * (itens não confirmados na documentação: PAYMENTS.md).
     */
    ASAAS_ADAPTER_VERIFIED: booleanFromEnv,
    PIX_EXPIRATION_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(60),

    /**
     * Consulta de autenticidade de notas. none = sem integração (resultado
     * "não verificável", revisão humana). dev = simulado, só desenvolvimento.
     */
    FISCAL_VERIFICATION_PROVIDER: z.enum(['none', 'dev']).default('none'),

    /**
     * log = só registra no log (testes). smtp = envia por SMTP_URL; em
     * desenvolvimento, o Mailpit do compose (http://localhost:8025).
     */
    EMAIL_PROVIDER: z.enum(['log', 'smtp']).default('log'),
    /** Ex.: smtp://usuario:senha@smtp.provedor.com:587 (URL de transporte do nodemailer). */
    SMTP_URL: z.string().optional(),
    EMAIL_FROM: z.string().default('SOS Comida <nao-responda@soscomida.local>'),

    /**
     * Rota do site que expira o cache das páginas públicas
     * (ex.: http://web:3000/interno/revalidar). Sem ela, o cache expira sozinho em até 5 min.
     */
    WEB_REVALIDATE_URL: z.url().optional(),
    WEB_REVALIDATE_SECRET: z.string().min(32, 'Use pelo menos 32 caracteres aleatórios').optional(),

    /** Se definido, /api/metrics exige `Authorization: Bearer <token>`. */
    METRICS_TOKEN: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test' && env.PAYMENTS_PROVIDER === 'dev') {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENTS_PROVIDER'],
        message: 'O provedor de desenvolvimento gera cobranças não pagáveis e é proibido fora de development/test.',
      });
    }
    if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test' && env.FISCAL_VERIFICATION_PROVIDER === 'dev') {
      ctx.addIssue({ code: 'custom', path: ['FISCAL_VERIFICATION_PROVIDER'], message: 'O provedor fiscal simulado é proibido fora de development/test.' });
    }
    if (env.WEB_REVALIDATE_URL && !env.WEB_REVALIDATE_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['WEB_REVALIDATE_SECRET'], message: 'WEB_REVALIDATE_SECRET é obrigatório com WEB_REVALIDATE_URL' });
    }
    if (env.EMAIL_PROVIDER === 'smtp' && !env.SMTP_URL) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'SMTP_URL é obrigatório com EMAIL_PROVIDER=smtp' });
    }
    if (env.NODE_ENV === 'production' && env.EMAIL_PROVIDER !== 'smtp') {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'Em produção os e-mails precisam sair de verdade: use EMAIL_PROVIDER=smtp.' });
    }
    if (env.PAYMENTS_PROVIDER === 'asaas') {
      for (const chave of ['ASAAS_BASE_URL', 'ASAAS_API_KEY', 'ASAAS_WEBHOOK_TOKEN'] as const) {
        if (!env[chave]) ctx.addIssue({ code: 'custom', path: [chave], message: `${chave} é obrigatório com PAYMENTS_PROVIDER=asaas` });
      }
      if (!env.ASAAS_ADAPTER_VERIFIED) {
        ctx.addIssue({
          code: 'custom',
          path: ['ASAAS_ADAPTER_VERIFIED'],
          message: 'O adaptador do Asaas ainda não foi validado no sandbox. Valide (docs/PAYMENTS.md) e defina ASAAS_ADAPTER_VERIFIED=true.',
        });
      }
    }
  });

export type AppConfig = z.infer<typeof envSchema> & {
  isProduction: boolean;
  sessionCookieName: string;
};

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const resultado = envSchema.safeParse(env);
  if (!resultado.success) {
    const problemas = resultado.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${problemas}`);
  }
  const config = resultado.data;
  const isProduction = config.NODE_ENV === 'production';
  return {
    ...config,
    isProduction,
    // O prefixo __Host- exige Secure (HTTPS); em dev o front roda em http://localhost.
    sessionCookieName: isProduction ? '__Host-sc_session' : 'sc_session',
  };
}

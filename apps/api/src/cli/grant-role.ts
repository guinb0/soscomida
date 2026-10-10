import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { roleSchema } from '@soscomida/contracts';
import { WorkerModule } from '../worker/worker.module';
import { IdentityService } from '../modules/identity';

/**
 * Concede um papel pela linha de comando — o único jeito de criar o primeiro
 * administrador. Uso: pnpm --filter @soscomida/api grant-role <email> <papel>
 */
async function main(): Promise<void> {
  const [email, papel] = process.argv.slice(2);
  const role = roleSchema.safeParse(papel);
  if (!email || !role.success) {
    console.error('Uso: grant-role <email> <moderator|admin|auditor>');
    process.exit(1);
  }
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error', 'warn'] });
  const identity = app.get(IdentityService);
  const userId = await identity.findUserIdByEmail(email);
  if (!userId) {
    console.error(`Nenhuma conta com o e-mail ${email}`);
    await app.close();
    process.exit(1);
  }
  await identity.grantRole(userId, role.data, null);
  console.warn(`Papel ${role.data} concedido a ${email}. O MFA será exigido no primeiro acesso à área restrita.`);
  await app.close();
}

void main();

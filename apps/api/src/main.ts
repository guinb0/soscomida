import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureHttpApp } from './bootstrap';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: true });
  const config = configureHttpApp(app);
  await app.listen(config.PORT);
}

void main();

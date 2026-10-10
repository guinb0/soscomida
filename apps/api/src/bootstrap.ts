import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from './infra/config/config';

/** Configuração HTTP compartilhada entre o `main.ts` e os testes de integração. */
export function configureHttpApp(app: INestApplication): AppConfig {
  const config = app.get<AppConfig>(APP_CONFIG);
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  // Atrás do Traefik: o IP real vem de X-Forwarded-For (um proxy de confiança).
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', 1);
  app.enableShutdownHooks();

  if (!config.isProduction) {
    const documento = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('SOS Comida API')
        .setDescription('Doações com prestação de contas verificável. Contratos em @soscomida/contracts.')
        .setVersion('0.1.0')
        .addCookieAuth('sc_session')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, documento);
  }
  return config;
}

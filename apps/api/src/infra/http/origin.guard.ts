import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { forbidden } from './errors';

export const SKIP_ORIGIN_CHECK = 'skipOriginCheck';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Proteção CSRF complementar ao SameSite=Lax: requisições que alteram estado
 * precisam vir de uma origem conhecida. Webhooks de provedores marcam
 * `@SkipOriginCheck()` e se autenticam por token próprio.
 *
 * Requisições sem cookie de sessão (ex.: Authorization: Bearer de um cliente
 * nativo) não são alvo de CSRF e passam.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ORIGIN_CHECK, [context.getHandler(), context.getClass()]);
    if (skip) return true;

    const cookies = request.cookies as Record<string, string> | undefined;
    if (!cookies?.[this.config.sessionCookieName]) return true;

    const origin = request.headers.origin ?? originFromReferer(request.headers.referer);
    if (origin && this.config.APP_ORIGINS.includes(origin)) return true;

    throw forbidden('Origem da requisição não permitida');
  }
}

function originFromReferer(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

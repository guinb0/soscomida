import { Body, Controller, Get, HttpCode, Inject, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type LoginInput,
  type Me,
  type MfaCodeInput,
  type MfaSetup,
  type RegisterInput,
  type Session,
  loginInputSchema,
  meSchema,
  mfaCodeInputSchema,
  mfaSetupSchema,
  registerInputSchema,
  sessionSchema,
} from '@soscomida/contracts';
import type { CookieOptions, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../../../infra/config/config';
import { Public } from '../../../infra/http/decorators';
import { ApiZodBody, ApiZodResponse, ZodPipe } from '../../../infra/http/zod';
import { type IssuedSession, IdentityService, type RequestMeta } from '../application/identity.service';
import type { AuthContext } from '../domain/auth-context';
import { CurrentUser, RequestMetaParam } from './auth.guards';

/**
 * Limite estrito para rotas de credencial: 10 por minuto por IP. Decorators
 * são avaliados no import, antes da injeção de configuração; por isso o valor
 * vem direto do ambiente (os testes de integração aumentam o limite).
 */
const AUTH_THROTTLE = { default: { limit: Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE ?? 10), ttl: 60_000 } };

@ApiTags('autenticação')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly identity: IdentityService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  @ApiZodBody(registerInputSchema)
  @ApiZodResponse(meSchema)
  async register(
    @Body(new ZodPipe(registerInputSchema)) input: RegisterInput,
    @RequestMetaParam() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    this.setSessionCookie(res, await this.identity.register(input, meta));
    return { ok: true };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(200)
  @ApiZodBody(loginInputSchema)
  async login(
    @Body(new ZodPipe(loginInputSchema)) input: LoginInput,
    @RequestMetaParam() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    this.setSessionCookie(res, await this.identity.login(input, meta));
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() auth: AuthContext, @Res({ passthrough: true }) res: Response): Promise<{ ok: true }> {
    await this.identity.logout(auth.sessionId);
    res.clearCookie(this.config.sessionCookieName, this.cookieOptions());
    return { ok: true };
  }

  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(
    @CurrentUser() auth: AuthContext,
    @RequestMetaParam() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.identity.logoutAll(auth.userId, meta);
    res.clearCookie(this.config.sessionCookieName, this.cookieOptions());
    return { ok: true };
  }

  /** Para o site: 200 com `user: null` para visitantes (evita um 401 a cada página). */
  @Public()
  @Get('session')
  @ApiZodResponse(sessionSchema)
  session(@CurrentUser() auth: AuthContext | undefined): Session {
    return { user: auth ? this.identity.me(auth) : null };
  }

  @Get('me')
  @ApiZodResponse(meSchema)
  me(@CurrentUser() auth: AuthContext): Me {
    return this.identity.me(auth);
  }

  @Post('mfa/setup')
  @ApiZodResponse(mfaSetupSchema)
  setupMfa(@CurrentUser() auth: AuthContext): Promise<MfaSetup> {
    return this.identity.setupMfa(auth);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('mfa/enable')
  @HttpCode(200)
  @ApiZodBody(mfaCodeInputSchema)
  async enableMfa(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodPipe(mfaCodeInputSchema)) input: MfaCodeInput,
    @RequestMetaParam() meta: RequestMeta,
  ): Promise<{ ok: true }> {
    await this.identity.enableMfa(auth, input.code, meta);
    return { ok: true };
  }

  @Throttle(AUTH_THROTTLE)
  @Post('mfa/verify')
  @HttpCode(200)
  @ApiZodBody(mfaCodeInputSchema)
  async verifyMfa(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodPipe(mfaCodeInputSchema)) input: MfaCodeInput,
    @RequestMetaParam() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    this.setSessionCookie(res, await this.identity.verifyMfa(auth, input.code, meta));
    return { ok: true };
  }

  private cookieOptions(): CookieOptions {
    return { httpOnly: true, secure: this.config.isProduction, sameSite: 'lax', path: '/' };
  }

  private setSessionCookie(res: Response, session: IssuedSession): void {
    res.cookie(this.config.sessionCookieName, session.token, { ...this.cookieOptions(), expires: session.expiresAt });
  }
}

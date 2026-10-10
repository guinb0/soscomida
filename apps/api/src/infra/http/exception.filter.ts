import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ApiError } from '@soscomida/contracts';
import type { Request, Response } from 'express';
import { ThrottlerException } from '@nestjs/throttler';
import { ZodError } from 'zod';
import { DomainError } from './errors';

/** Converte qualquer erro no formato `ApiError`, sem vazar detalhes internos. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();
    const requestId = typeof request.id === 'string' ? request.id : undefined;

    const { status, body } = this.toApiError(exception);
    if (status >= 500) {
      this.logger.error({ err: exception, requestId }, 'Erro não tratado');
    }
    response.status(status).json({ ...body, requestId });
  }

  private toApiError(exception: unknown): { status: number; body: ApiError } {
    if (exception instanceof DomainError) {
      return { status: exception.status, body: { code: exception.code, message: exception.message, details: exception.details } };
    }
    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          code: 'VALIDATION_ERROR',
          message: exception.issues[0]?.message ?? 'Dados inválidos',
          details: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      };
    }
    if (exception instanceof ThrottlerException) {
      return { status: HttpStatus.TOO_MANY_REQUESTS, body: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde um pouco.' } };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const codigo = status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : 'HTTP_ERROR';
      return { status, body: { code: codigo, message: status === 404 ? 'Recurso não encontrado' : exception.message } };
    }
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: { code: 'INTERNAL_ERROR', message: 'Erro interno. Tente novamente.' } };
  }
}

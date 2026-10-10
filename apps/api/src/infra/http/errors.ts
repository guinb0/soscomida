import { HttpStatus } from '@nestjs/common';

/**
 * Erro de negócio com código estável. Os códigos são contrato com o front
 * (ex.: o front trata `MFA_REQUIRED` abrindo o desafio de MFA).
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const notFound = (what: string) => new DomainError('NOT_FOUND', `${what} não encontrado(a)`, HttpStatus.NOT_FOUND);
export const forbidden = (message = 'Você não tem permissão para esta ação') =>
  new DomainError('FORBIDDEN', message, HttpStatus.FORBIDDEN);
export const conflict = (code: string, message: string) => new DomainError(code, message, HttpStatus.CONFLICT);
export const versionConflict = () =>
  conflict('VERSION_CONFLICT', 'Este registro foi alterado por outra pessoa. Recarregue e tente de novo.');

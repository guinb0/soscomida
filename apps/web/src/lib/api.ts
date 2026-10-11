import type { ApiError } from '@soscomida/contracts';

/** Erro devolvido pela API, com o código estável do contrato (ex.: MFA_REQUIRED). */
export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & { json?: unknown };

/**
 * Chamada à API pelo navegador. Mesma origem (`/api`, repassado pelo Next),
 * então o cookie de sessão vai junto e o `Origin` confere com a API.
 */
export async function api<T>(path: string, { json, headers, ...init }: RequestOptions = {}): Promise<T> {
  const resposta = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  if (resposta.status === 204) return undefined as T;

  const corpo = (await resposta.json().catch(() => null)) as (ApiError & Record<string, unknown>) | null;
  if (!resposta.ok) {
    throw new ApiClientError(resposta.status, corpo?.code ?? 'HTTP_ERROR', corpo?.message ?? 'Algo deu errado. Tente novamente.', corpo?.details);
  }
  return corpo as T;
}

/** Mensagem amigável para qualquer erro. */
export const errorMessage = (error: unknown) =>
  error instanceof ApiClientError ? error.message : 'Não foi possível concluir. Verifique sua conexão e tente de novo.';

/** Erros que pedem verificação em duas etapas antes de continuar. */
export const needsMfa = (error: unknown) =>
  error instanceof ApiClientError && (error.code === 'MFA_REQUIRED' || error.code === 'MFA_SETUP_REQUIRED');

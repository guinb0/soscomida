import { z } from 'zod';

export const uuidSchema = z.uuid();

/** Inteiro em centavos, positivo, dentro do inteiro seguro. */
export const centsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/** Formato de todo erro devolvido pela API. */
export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });
}

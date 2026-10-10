import { applyDecorators, type PipeTransform } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { z } from 'zod';

/** Valida corpo/query com o schema de `@soscomida/contracts`. Erro vira 400 no filtro. */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    return this.schema.parse(value);
  }
}

const jsonSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;

/** Documenta o corpo no OpenAPI a partir do mesmo schema Zod usado na validação. */
export const ApiZodBody = (schema: z.ZodType) => ApiBody({ schema: jsonSchema(schema) });

export const ApiZodResponse = (schema: z.ZodType, description = 'OK') =>
  ApiOkResponse({ description, schema: z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown> });

export const ApiZodQuery = (schema: z.ZodObject) =>
  applyDecorators(
    ...Object.keys(schema.shape).map((name) => ApiQuery({ name, required: false })),
  );

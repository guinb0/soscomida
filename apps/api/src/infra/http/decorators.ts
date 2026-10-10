import { SetMetadata } from '@nestjs/common';
import { SKIP_ORIGIN_CHECK } from './origin.guard';

export const IS_PUBLIC = 'isPublic';

/** Rota acessível sem sessão. Por padrão toda rota exige login. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Rota chamada por terceiros (webhooks), autenticada por token próprio. */
export const SkipOriginCheck = () => SetMetadata(SKIP_ORIGIN_CHECK, true);

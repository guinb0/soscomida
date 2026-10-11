import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type DonationCheckout,
  type MyDonation,
  createDonationInputSchema,
  donationCheckoutSchema,
} from '@soscomida/contracts';
import { z } from 'zod';
import { Public } from '../../infra/http/decorators';
import { DomainError } from '../../infra/http/errors';
import { ApiZodBody, ApiZodResponse, ZodPipe } from '../../infra/http/zod';
import { type AuthContext, CurrentUser } from '../identity';
import { DonationsService } from './donations.service';

const idempotencyKeySchema = z.uuid('Envie o cabeçalho Idempotency-Key com um UUID');

@ApiTags('doações')
@Controller()
export class DonationsController {
  constructor(private readonly donations: DonationsService) {}

  /** Visitante pode doar sem conta; se houver sessão, a doação fica no histórico dela. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('donations')
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID gerado pelo cliente por tentativa de doação' })
  @ApiZodBody(createDonationInputSchema)
  @ApiZodResponse(donationCheckoutSchema)
  create(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodPipe(createDonationInputSchema)) input: z.output<typeof createDonationInputSchema>,
    @CurrentUser() auth?: AuthContext,
  ): Promise<DonationCheckout> {
    const chave = idempotencyKeySchema.safeParse(idempotencyKey);
    if (!chave.success) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', chave.error.issues[0]!.message, 400);
    return this.donations.create(input, chave.data, auth);
  }

  /** Estado da doação (tela do QR Code consulta até confirmar). */
  @Public()
  @Get('donations/:id')
  @ApiZodResponse(donationCheckoutSchema)
  checkout(@Param('id', ParseUUIDPipe) id: string): Promise<DonationCheckout> {
    return this.donations.getCheckout(id);
  }

  @Get('me/donations')
  mine(@CurrentUser() auth: AuthContext): Promise<MyDonation[]> {
    return this.donations.listMine(auth);
  }
}

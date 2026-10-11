import { Controller, Get, Module, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type CampaignTransparency, campaignTransparencySchema } from '@soscomida/contracts';
import { Public } from '../../infra/http/decorators';
import { ApiZodResponse } from '../../infra/http/zod';
import { CampaignsModule, CampaignsService } from '../campaigns';
import { DonationsModule, DonationsService } from '../donations';
import { LedgerModule, LedgerService } from '../ledger';

/**
 * Painel público de transparência. Cada número vem de uma fonte
 * identificável: arrecadação, tarifas e estornos do ledger (espelho do que o
 * provedor confirmou); orçamento da campanha; apoiadores das doações
 * confirmadas. Despesas comprovadas entram na Fase 2.
 */
@ApiTags('transparência')
@Controller('campaigns')
class TransparencyController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly ledger: LedgerService,
    private readonly donations: DonationsService,
  ) {}

  @Public()
  @Get(':slug/transparency')
  @ApiZodResponse(campaignTransparencySchema)
  async transparency(@Param('slug') slug: string): Promise<CampaignTransparency> {
    const campanha = await this.campaigns.getPublicBySlug(slug);
    const [resumo, apoiadores] = await Promise.all([
      this.ledger.campaignSummary(campanha.id),
      this.donations.recentSupporters(campanha.id, 10),
    ]);
    return {
      goalCents: campanha.goalCents,
      confirmedCents: resumo.confirmedCents,
      donationsCount: resumo.donationsCount,
      feesCents: resumo.feesCents,
      refundsCents: resumo.refundsCents,
      netEstimateCents: resumo.confirmedCents - resumo.feesCents - resumo.refundsCents,
      transferredCents: resumo.transfersCents,
      budget: campanha.budget.map(({ category, description, plannedCents }) => ({ category, description, plannedCents })),
      expenses: { available: false },
      recentSupporters: apoiadores,
      generatedAt: new Date().toISOString(),
    };
  }
}

@Module({
  imports: [CampaignsModule, LedgerModule, DonationsModule],
  controllers: [TransparencyController],
})
export class TransparencyModule {}

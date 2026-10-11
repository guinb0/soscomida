import { Controller, Get, Module, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type CampaignTransparency, campaignTransparencySchema } from '@soscomida/contracts';
import { Public } from '../../infra/http/decorators';
import { ApiZodResponse } from '../../infra/http/zod';
import { CampaignsModule, CampaignsService } from '../campaigns';
import { DonationsModule, DonationsService } from '../donations';
import { ExpensesModule, ExpensesService } from '../expenses';
import { LedgerModule, LedgerService } from '../ledger';

/**
 * Painel público de transparência. Cada número vem de uma fonte
 * identificável: arrecadação, tarifas e estornos do ledger (espelho do que o
 * provedor confirmou); orçamento da campanha; apoiadores das doações
 * confirmadas; despesas da prestação de contas, separadas por status.
 */
@ApiTags('transparência')
@Controller('campaigns')
class TransparencyController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly ledger: LedgerService,
    private readonly donations: DonationsService,
    private readonly expenses: ExpensesService,
  ) {}

  @Public()
  @Get(':slug/transparency')
  @ApiZodResponse(campaignTransparencySchema)
  async transparency(@Param('slug') slug: string): Promise<CampaignTransparency> {
    const campanha = await this.campaigns.getPublicBySlug(slug);
    const [resumo, apoiadores, despesas] = await Promise.all([
      this.ledger.campaignSummary(campanha.id),
      this.donations.recentSupporters(campanha.id, 10),
      this.expenses.transparencySummary(campanha.id),
    ]);
    const planejado = new Map<string, number>();
    for (const b of campanha.budget) planejado.set(b.category, (planejado.get(b.category) ?? 0) + b.plannedCents);
    const categorias = [...new Set([...planejado.keys(), ...despesas.byCategory.keys()])];
    return {
      goalCents: campanha.goalCents,
      confirmedCents: resumo.confirmedCents,
      donationsCount: resumo.donationsCount,
      feesCents: resumo.feesCents,
      refundsCents: resumo.refundsCents,
      netEstimateCents: resumo.confirmedCents - resumo.feesCents - resumo.refundsCents,
      transferredCents: resumo.transfersCents,
      budget: campanha.budget.map(({ category, description, plannedCents }) => ({ category, description, plannedCents })),
      expenses: {
        available: true,
        approvedCents: despesas.approvedCents,
        inReviewCents: despesas.inReviewCents,
        rejectedCount: despesas.rejectedCount,
        fiscallyAuthenticatedCents: despesas.fiscallyAuthenticatedCents,
        byCategory: categorias.map((c) => ({
          category: c as CampaignTransparency['budget'][number]['category'],
          plannedCents: planejado.get(c) ?? 0,
          approvedCents: despesas.byCategory.get(c)?.approvedCents ?? 0,
          inReviewCents: despesas.byCategory.get(c)?.inReviewCents ?? 0,
        })),
      },
      recentSupporters: apoiadores,
      generatedAt: new Date().toISOString(),
    };
  }
}

@Module({
  imports: [CampaignsModule, LedgerModule, DonationsModule, ExpensesModule],
  controllers: [TransparencyController],
})
export class TransparencyModule {}

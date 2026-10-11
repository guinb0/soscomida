import { Inject, Injectable, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../infra/config/config';
import { CAMPAIGN_EVENTS, CampaignsModule, CampaignsService, DONATION_LEDGER_EVENTS } from '../campaigns';
import { EXPENSE_EVENTS, ExpensesModule, ExpensesService } from '../expenses';
import { FISCAL_EVENTS } from '../fiscal';
import { EventHandlerRegistry } from '../outbox';

/**
 * Expira o cache das páginas públicas do site quando uma campanha muda.
 * Melhor esforço: se o site não responder, o cache expira sozinho (TTL) e o
 * evento não é reprocessado por causa disso.
 */
@Injectable()
export class WebCacheService {
  private readonly logger = new Logger(WebCacheService.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get enabled(): boolean {
    return Boolean(this.config.WEB_REVALIDATE_URL);
  }

  async revalidate(tags: string[]): Promise<boolean> {
    if (!this.config.WEB_REVALIDATE_URL) return false;
    try {
      const resposta = await fetch(this.config.WEB_REVALIDATE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.WEB_REVALIDATE_SECRET}` },
        body: JSON.stringify({ tags }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!resposta.ok) this.logger.warn({ status: resposta.status, tags }, 'O site recusou a invalidação de cache');
      return resposta.ok;
    } catch (error) {
      this.logger.warn({ err: error instanceof Error ? error.message : String(error), tags }, 'Falha ao invalidar o cache do site');
      return false;
    }
  }
}

@Module({
  imports: [CampaignsModule, ExpensesModule],
  providers: [WebCacheService],
  exports: [WebCacheService],
})
export class WebCacheModule implements OnModuleInit {
  constructor(
    private readonly cache: WebCacheService,
    private readonly campaigns: CampaignsService,
    private readonly expenses: ExpensesService,
    private readonly events: EventHandlerRegistry,
  ) {}

  onModuleInit(): void {
    if (!this.cache.enabled) return;
    const invalidar = async (campaignId: unknown) => {
      const campanha = (await this.campaigns.summariesByIds([String(campaignId)])).get(String(campaignId));
      // Lista e home mostram status e valores arrecadados: caem junto.
      await this.cache.revalidate(campanha ? ['campaigns', `campaign:${campanha.slug}`] : ['campaigns']);
    };
    this.events.on(CAMPAIGN_EVENTS.statusChanged, (e) => invalidar(e.payload.campaignId));
    this.events.on(CAMPAIGN_EVENTS.updatePosted, (e) => invalidar(e.payload.campaignId));
    for (const tipo of DONATION_LEDGER_EVENTS) this.events.on(tipo, (e) => invalidar(e.payload.campaignId));
    this.events.on(EXPENSE_EVENTS.statusChanged, (e) => invalidar(e.payload.campaignId));
    // Nota verificada muda o selo fiscal das despesas que a usam.
    this.events.on(FISCAL_EVENTS.verified, async (e) => {
      for (const id of await this.expenses.campaignsUsingFiscalDocument(String(e.payload.documentId))) await invalidar(id);
    });
  }
}

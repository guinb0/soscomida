import { Module, type OnModuleInit } from '@nestjs/common';
import { JobRegistry } from '../../infra/queue/job-registry';
import { QUEUES } from '../../infra/queue/queue';
import { IdentityModule } from '../identity';
import { LedgerModule } from '../ledger';
import { EventHandlerRegistry } from '../outbox';
import { StorageModule } from '../storage';
import { CampaignsService } from './application/campaigns.service';
import { OrganizerCampaignsController, PublicCampaignsController } from './http/campaigns.controller';

export { CampaignsService, CAMPAIGN_EVENTS, type DonationTarget, type StatusChangeCommand } from './application/campaigns.service';
export { type CampaignAction, allowedActions, PUBLIC_STATUSES } from './domain/campaign-status';

/** Eventos de doação que mudam os números públicos da campanha. */
export const DONATION_LEDGER_EVENTS = ['DonationConfirmed', 'DonationRefunded'] as const;

@Module({
  imports: [IdentityModule, LedgerModule, StorageModule],
  controllers: [PublicCampaignsController, OrganizerCampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule implements OnModuleInit {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly events: EventHandlerRegistry,
    private readonly jobs: JobRegistry,
  ) {}

  onModuleInit(): void {
    for (const tipo of DONATION_LEDGER_EVENTS) {
      this.events.on(tipo, async (evento) => {
        await this.campaigns.refreshStats(String(evento.payload.campaignId));
      });
    }
    this.jobs.handle(QUEUES.maintenance, 'campaigns.expire-due', () => this.campaigns.expireDue());
    this.jobs.schedule({ queue: QUEUES.maintenance, name: 'campaigns.expire-due', everyMs: 5 * 60_000 });
  }
}

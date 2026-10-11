import { Module, type OnModuleInit } from '@nestjs/common';
import { CampaignsModule } from '../campaigns';
import { LedgerModule } from '../ledger';
import { PaymentsModule, SettlementRegistry } from '../payments';
import { DonationsController } from './donations.controller';
import { DonationsService } from './donations.service';

export { DonationsService, DONATION_EVENTS } from './donations.service';

@Module({
  imports: [CampaignsModule, PaymentsModule, LedgerModule],
  controllers: [DonationsController],
  providers: [DonationsService],
  exports: [DonationsService],
})
export class DonationsModule implements OnModuleInit {
  constructor(
    private readonly donations: DonationsService,
    private readonly settlements: SettlementRegistry,
  ) {}

  /** Doações liquidam as cobranças que criam (porta definida em payments). */
  onModuleInit(): void {
    this.settlements.register(this.donations.referenceType, this.donations);
  }
}

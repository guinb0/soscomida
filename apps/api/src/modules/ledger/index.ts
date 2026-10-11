import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';

export { LedgerService, type CampaignLedgerSummary } from './ledger.service';
export {
  LEDGER_KINDS,
  UnbalancedPostingError,
  donationConfirmedPosting,
  donationRefundedPosting,
  type Posting,
} from './domain/postings';

@Module({ providers: [LedgerService], exports: [LedgerService] })
export class LedgerModule {}

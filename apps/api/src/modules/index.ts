import { AuditModule } from './audit';
import { CampaignsModule } from './campaigns';
import { DonationsModule } from './donations';
import { IdentityModule } from './identity';
import { LedgerModule } from './ledger';
import { ModerationModule } from './moderation';
import { OutboxModule } from './outbox';
import { PaymentsModule } from './payments';
import { StorageModule } from './storage';
import { TransparencyModule } from './transparency';

/**
 * Módulos de domínio carregados pela API e pelo worker. A ordem segue as
 * dependências (docs/ARCHITECTURE.md §3): base primeiro.
 */
export const DOMAIN_MODULES = [
  AuditModule,
  OutboxModule,
  IdentityModule,
  StorageModule,
  LedgerModule,
  CampaignsModule,
  ModerationModule,
  PaymentsModule,
  DonationsModule,
  TransparencyModule,
];

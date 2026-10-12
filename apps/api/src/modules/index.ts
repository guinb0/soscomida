import { AiModule } from './ai';
import { AuditModule } from './audit';
import { CampaignsModule } from './campaigns';
import { DonationsModule } from './donations';
import { ExpensesModule } from './expenses';
import { FiscalModule } from './fiscal';
import { IdentityModule } from './identity';
import { LedgerModule } from './ledger';
import { ModerationModule } from './moderation';
import { NotificationsModule } from './notifications';
import { OutboxModule } from './outbox';
import { PaymentsModule } from './payments';
import { StorageModule } from './storage';
import { TransparencyModule } from './transparency';
import { WebCacheModule } from './web-cache';

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
  AiModule,
  CampaignsModule,
  ModerationModule,
  PaymentsModule,
  DonationsModule,
  FiscalModule,
  ExpensesModule,
  TransparencyModule,
  NotificationsModule,
  WebCacheModule,
];

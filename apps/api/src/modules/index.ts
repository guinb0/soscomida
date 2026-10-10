import { AuditModule } from './audit';
import { IdentityModule } from './identity';
import { OutboxModule } from './outbox';

/**
 * Módulos de domínio carregados pela API e pelo worker. A ordem segue as
 * dependências (docs/ARCHITECTURE.md §3): base primeiro.
 */
export const DOMAIN_MODULES = [AuditModule, OutboxModule, IdentityModule];

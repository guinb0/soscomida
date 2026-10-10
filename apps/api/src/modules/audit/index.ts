import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

export { AuditService, type AuditEntry } from './audit.service';

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}

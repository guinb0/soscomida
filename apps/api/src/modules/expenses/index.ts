import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { CampaignsModule } from '../campaigns';
import { FiscalModule } from '../fiscal';
import { IdentityModule } from '../identity';
import { StorageModule } from '../storage';
import { OrganizerExpensesController, PublicExpensesController, ReviewExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

export { ExpensesService, EXPENSE_EVENTS } from './expenses.service';

@Module({
  imports: [AuditModule, CampaignsModule, FiscalModule, IdentityModule, StorageModule],
  controllers: [OrganizerExpensesController, ReviewExpensesController, PublicExpensesController],
  providers: [ExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}

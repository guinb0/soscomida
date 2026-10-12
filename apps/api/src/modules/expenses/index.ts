import { Module, type OnModuleInit } from '@nestjs/common';
import { AiModule } from '../ai';
import { AuditModule } from '../audit';
import { CampaignsModule } from '../campaigns';
import { FiscalModule } from '../fiscal';
import { IdentityModule } from '../identity';
import { EventHandlerRegistry } from '../outbox';
import { StorageModule } from '../storage';
import { ExpenseAnalysisService } from './expense-analysis.service';
import { OrganizerExpensesController, PublicExpensesController, ReviewExpensesController, RiskPolicyController } from './expenses.controller';
import { EXPENSE_EVENTS, ExpensesService } from './expenses.service';
import { RiskPolicyService } from './risk-policy.service';

export { ExpensesService, EXPENSE_EVENTS } from './expenses.service';
export { ExpenseAnalysisService } from './expense-analysis.service';

@Module({
  imports: [AiModule, AuditModule, CampaignsModule, FiscalModule, IdentityModule, StorageModule],
  controllers: [OrganizerExpensesController, ReviewExpensesController, PublicExpensesController, RiskPolicyController],
  providers: [ExpensesService, ExpenseAnalysisService, RiskPolicyService],
  exports: [ExpensesService, ExpenseAnalysisService],
})
export class ExpensesModule implements OnModuleInit {
  constructor(
    private readonly analysis: ExpenseAnalysisService,
    private readonly events: EventHandlerRegistry,
  ) {}

  onModuleInit(): void {
    // Toda despesa que entra na fila (envio ou contestação) é analisada no worker.
    this.events.on(EXPENSE_EVENTS.statusChanged, async (e) => {
      if (e.payload.to !== 'SUBMITTED') return;
      await this.analysis.analyze(String(e.payload.expenseId), 'SUBMITTED', { sourceEventId: e.id });
    });
  }
}

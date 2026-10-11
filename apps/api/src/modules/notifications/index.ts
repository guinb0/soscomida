import { Inject, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../infra/config/config';
import { CAMPAIGN_EVENTS, CampaignsModule, CampaignsService } from '../campaigns';
import { IdentityModule } from '../identity';
import { EventHandlerRegistry } from '../outbox';
import {
  campaignStatusEmail,
  donationConfirmedEmail,
  expenseDecisionEmail,
  isNotifiedCampaignAction,
  isNotifiedExpenseAction,
} from './domain/templates';
import { EMAIL_SENDER, type EmailSender, LogEmailSender, SmtpEmailSender } from './infra/email-sender';
import { NotificationsService } from './notifications.service';

export { NotificationsService } from './notifications.service';
export { EMAIL_SENDER, type EmailSender, type EmailMessage, LogEmailSender } from './infra/email-sender';

function createSender(config: AppConfig): EmailSender {
  // A validação de configuração já exige SMTP_URL com EMAIL_PROVIDER=smtp.
  return config.EMAIL_PROVIDER === 'smtp' ? new SmtpEmailSender(config.SMTP_URL!, config.EMAIL_FROM) : new LogEmailSender();
}

/**
 * Avisos por e-mail disparados por eventos de domínio (outbox → worker).
 * Doação confirmada: só para quem doou logado (de convidados não guardamos
 * e-mail). Mudanças de status relevantes: para quem organiza.
 */
@Module({
  imports: [IdentityModule, CampaignsModule],
  providers: [NotificationsService, { provide: EMAIL_SENDER, inject: [APP_CONFIG], useFactory: createSender }],
  exports: [NotificationsService, EMAIL_SENDER],
})
export class NotificationsModule implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly campaigns: CampaignsService,
    private readonly events: EventHandlerRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
  ) {}

  onModuleInit(): void {
    const web = this.config.PUBLIC_WEB_URL.replace(/\/$/, '');

    this.events.on('DonationConfirmed', async (evento) => {
      const p = evento.payload;
      if (typeof p.donorUserId !== 'string') return;
      const campanha = (await this.campaigns.summariesByIds([String(p.campaignId)])).get(String(p.campaignId));
      if (!campanha) return;
      await this.notifications.notify({
        dedupeKey: `donation_confirmed:${String(p.donationId)}`,
        userId: p.donorUserId,
        template: 'donation_confirmed',
        render: ({ name }) =>
          donationConfirmedEmail({ name, amountCents: Number(p.amountCents), campaignTitle: campanha.title, campaignUrl: `${web}/campanhas/${campanha.slug}` }),
      });
    });

    this.registerExpenseHandlers(web);

    this.events.on(CAMPAIGN_EVENTS.statusChanged, async (evento) => {
      const p = evento.payload;
      const acao = String(p.action);
      if (!isNotifiedCampaignAction(acao) || typeof p.organizerId !== 'string') return;
      const campanhaId = String(p.campaignId);
      const campanha = (await this.campaigns.summariesByIds([campanhaId])).get(campanhaId);
      if (!campanha) return;
      await this.notifications.notify({
        dedupeKey: `campaign_status:${evento.id}`,
        userId: p.organizerId,
        template: `campaign_${acao}`,
        render: ({ name }) =>
          campaignStatusEmail({
            name,
            action: acao,
            campaignTitle: campanha.title,
            reason: typeof p.reason === 'string' ? p.reason : null,
            panelUrl: `${web}/painel/campanhas/${campanhaId}`,
          }),
      });
    });
  }

  private registerExpenseHandlers(web: string): void {
    this.events.on('ExpenseStatusChanged', async (evento) => {
      const p = evento.payload;
      const acao = String(p.action);
      if (!isNotifiedExpenseAction(acao) || typeof p.createdBy !== 'string') return;
      const campanhaId = String(p.campaignId);
      const campanha = (await this.campaigns.summariesByIds([campanhaId])).get(campanhaId);
      if (!campanha) return;
      await this.notifications.notify({
        dedupeKey: `expense_status:${evento.id}`,
        userId: p.createdBy,
        template: `expense_${acao}`,
        render: ({ name }) =>
          expenseDecisionEmail({
            name,
            action: acao,
            expenseDescription: typeof p.description === 'string' ? p.description : 'despesa',
            campaignTitle: campanha.title,
            reason: typeof p.reason === 'string' ? p.reason : null,
            url: `${web}/painel/despesas/${String(p.expenseId)}`,
          }),
      });
    });
  }

  onModuleDestroy(): void {
    this.sender.close();
  }
}

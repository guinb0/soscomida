import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DB, type Database } from '../../infra/db/db';
import { newId } from '../../infra/ids';
import { IdentityService } from '../identity';
import type { RenderedEmail } from './domain/templates';
import { EMAIL_SENDER, type EmailSender } from './infra/email-sender';
import { emailNotifications } from './infra/notifications.schema';

export interface NotifyCommand {
  /** Identifica o acontecimento: a mesma chave nunca gera dois e-mails. */
  dedupeKey: string;
  userId: string;
  template: string;
  render: (contact: { name: string }) => RenderedEmail;
}

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
    private readonly identity: IdentityService,
  ) {}

  /**
   * Envia no máximo uma vez por `dedupeKey`. A linha fica travada durante o
   * envio, então duas entregas simultâneas do mesmo evento não duplicam o
   * e-mail. Se o SMTP falhar, a exceção sobe e a fila tenta de novo.
   */
  async notify(cmd: NotifyCommand): Promise<'SENT' | 'SKIPPED' | 'ALREADY_DONE'> {
    await this.db
      .insert(emailNotifications)
      .values({ id: newId(), dedupeKey: cmd.dedupeKey, userId: cmd.userId, template: cmd.template })
      .onConflictDoNothing();

    let falha: unknown = null;
    const resultado = await this.db.transaction(async (tx) => {
      const [linha] = await tx.select().from(emailNotifications).where(eq(emailNotifications.dedupeKey, cmd.dedupeKey)).for('update');
      if (!linha || linha.status !== 'PENDING') return 'ALREADY_DONE' as const;

      const contato = (await this.identity.contacts([cmd.userId])).get(cmd.userId);
      if (!contato) {
        await tx.update(emailNotifications).set({ status: 'SKIPPED' }).where(eq(emailNotifications.id, linha.id));
        return 'SKIPPED' as const;
      }
      try {
        const { messageId } = await this.sender.send({ to: contato.email, ...cmd.render(contato) });
        await tx
          .update(emailNotifications)
          .set({ status: 'SENT', sentAt: new Date(), providerMessageId: messageId, attempts: sql`${emailNotifications.attempts} + 1`, lastError: null })
          .where(eq(emailNotifications.id, linha.id));
        return 'SENT' as const;
      } catch (error) {
        falha = error;
        return null;
      }
    });

    if (resultado) return resultado;
    const mensagem = falha instanceof Error ? falha.message : String(falha);
    await this.db
      .update(emailNotifications)
      .set({ attempts: sql`${emailNotifications.attempts} + 1`, lastError: mensagem.slice(0, 1000) })
      .where(eq(emailNotifications.dedupeKey, cmd.dedupeKey));
    throw falha instanceof Error ? falha : new Error(mensagem);
  }
}

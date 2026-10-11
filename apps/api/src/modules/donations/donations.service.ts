import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { DonationCheckout, DonationStatus, MyDonation, PublicSupporter } from '@soscomida/contracts';
import type { z } from 'zod';
import type { createDonationInputSchema } from '@soscomida/contracts';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../../infra/config/config';
import { DB, type Database, type Executor, isUniqueViolation } from '../../infra/db/db';
import { DomainError, notFound } from '../../infra/http/errors';
import { newId } from '../../infra/ids';
import { CampaignsService } from '../campaigns';
import type { AuthContext } from '../identity';
import { LedgerService, donationConfirmedPosting, donationRefundedPosting } from '../ledger';
import { OutboxService } from '../outbox';
import { type ChargeSnapshot, PaymentsService, type SettledIntent, type SettlementHandler } from '../payments';
import { donations } from './infra/donations.schema';

type CreateDonation = z.output<typeof createDonationInputSchema>;
type DonationRow = typeof donations.$inferSelect;

export const DONATION_EVENTS = {
  confirmed: 'DonationConfirmed',
  refunded: 'DonationRefunded',
} as const;

const REFERENCE_TYPE = 'donation';

@Injectable()
export class DonationsService implements SettlementHandler {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly campaigns: CampaignsService,
    private readonly payments: PaymentsService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
  ) {}

  get referenceType(): string {
    return REFERENCE_TYPE;
  }

  /**
   * Cria a doação e a cobrança Pix. Idempotente pela chave do cliente: um
   * duplo clique ou uma nova tentativa depois de timeout devolve a mesma
   * doação, sem cobrar duas vezes.
   */
  async create(input: CreateDonation, idempotencyKey: string, auth: AuthContext | undefined): Promise<DonationCheckout> {
    const existente = await this.findByKey(idempotencyKey);
    if (existente) return this.checkoutFor(existente, input);

    const alvo = await this.campaigns.getDonationTarget(input.campaignId);
    if (!alvo) throw notFound('Campanha');
    if (!alvo.acceptsDonations) {
      throw new DomainError('CAMPAIGN_NOT_ACCEPTING_DONATIONS', 'Esta campanha não está recebendo doações', HttpStatus.CONFLICT);
    }

    const donationId = newId();
    let intentId: string;
    try {
      intentId = await this.db.transaction(async (tx) => {
        await tx.insert(donations).values({
          id: donationId,
          campaignId: alvo.id,
          donorUserId: auth?.userId ?? null,
          displayName: input.anonymous ? null : (input.displayName?.trim() || auth?.name || null),
          isAnonymous: input.anonymous,
          amountCents: input.amountCents,
          idempotencyKey,
        });
        return this.payments.createIntent(tx, { referenceType: REFERENCE_TYPE, referenceId: donationId, amountCents: input.amountCents });
      });
    } catch (error) {
      // Corrida com a mesma chave: a outra requisição venceu; devolve o resultado dela.
      if (isUniqueViolation(error, 'donations_idempotency_key')) {
        const vencedora = await this.findByKey(idempotencyKey);
        if (vencedora) return this.checkoutFor(vencedora, input);
      }
      throw error;
    }

    await this.payments.requestPixCharge(intentId, {
      description: `Doação para "${alvo.title}" via SOS Comida`,
      expiresAt: new Date(Date.now() + this.config.PIX_EXPIRATION_MINUTES * 60_000),
      payer: { name: input.payer.name, cpf: input.payer.cpf, email: input.payer.email },
    });
    return this.getCheckout(donationId);
  }

  /** Estado da doação para a tela de pagamento (consultada em polling). */
  async getCheckout(donationId: string): Promise<DonationCheckout> {
    const [doacao] = await this.db.select().from(donations).where(eq(donations.id, donationId)).limit(1);
    if (!doacao) throw notFound('Doação');
    const intent = await this.payments.getByReference(REFERENCE_TYPE, donationId);
    const pendente = doacao.status === 'PENDING' && intent?.status === 'AWAITING_PAYMENT';
    return {
      donationId: doacao.id,
      status: doacao.status as DonationStatus,
      amountCents: doacao.amountCents,
      pix: pendente && intent?.pixCopyPaste && intent.expiresAt ? { copyPaste: intent.pixCopyPaste, expiresAt: intent.expiresAt.toISOString() } : null,
      developmentOnly: intent ? !intent.realMoney : false,
    };
  }

  async listMine(auth: AuthContext): Promise<MyDonation[]> {
    const linhas = await this.db.select().from(donations).where(eq(donations.donorUserId, auth.userId)).orderBy(desc(donations.createdAt)).limit(200);
    const campanhas = await this.campaigns.summariesByIds([...new Set(linhas.map((l) => l.campaignId))]);
    return linhas.map((l) => ({
      id: l.id,
      campaignId: l.campaignId,
      campaignTitle: campanhas.get(l.campaignId)?.title ?? 'Campanha',
      campaignSlug: campanhas.get(l.campaignId)?.slug ?? '',
      amountCents: l.amountCents,
      status: l.status as DonationStatus,
      createdAt: l.createdAt.toISOString(),
      confirmedAt: l.confirmedAt?.toISOString() ?? null,
    }));
  }

  /** Apoiadores recentes para a página pública (nome só se a pessoa permitiu). */
  async recentSupporters(campaignId: string, limit = 10): Promise<PublicSupporter[]> {
    const linhas = await this.db
      .select()
      .from(donations)
      .where(and(eq(donations.campaignId, campaignId), eq(donations.status, 'CONFIRMED')))
      .orderBy(desc(donations.confirmedAt))
      .limit(limit);
    return linhas.map((l) => ({
      displayName: l.isAnonymous || !l.displayName ? 'Apoiador anônimo' : l.displayName,
      amountCents: l.amountCents,
      confirmedAt: l.confirmedAt!.toISOString(),
    }));
  }

  // --- SettlementHandler: chamado na transação que muda a cobrança -------------

  async onConfirmed(tx: Executor, intent: SettledIntent, _snapshot: ChargeSnapshot): Promise<void> {
    const doacao = await this.lockDonation(tx, intent.referenceId);
    if (doacao.status === 'CONFIRMED' || doacao.status === 'REFUNDED') return;

    await tx.update(donations).set({ status: 'CONFIRMED', confirmedAt: new Date(), updatedAt: new Date() }).where(eq(donations.id, doacao.id));
    await this.ledger.post(
      tx,
      donationConfirmedPosting({
        donationId: doacao.id,
        campaignId: doacao.campaignId,
        provider: intent.provider,
        grossCents: intent.amountCents,
        feeCents: intent.feeCents,
      }),
    );
    await this.outbox.add(tx, {
      type: DONATION_EVENTS.confirmed,
      aggregateType: 'donation',
      aggregateId: doacao.id,
      payload: { donationId: doacao.id, campaignId: doacao.campaignId, amountCents: doacao.amountCents, donorUserId: doacao.donorUserId },
    });
  }

  async onRefunded(tx: Executor, intent: SettledIntent, _snapshot: ChargeSnapshot): Promise<void> {
    const doacao = await this.lockDonation(tx, intent.referenceId);
    if (doacao.status === 'REFUNDED') return;

    await tx.update(donations).set({ status: 'REFUNDED', updatedAt: new Date() }).where(eq(donations.id, doacao.id));
    await this.ledger.post(
      tx,
      donationRefundedPosting({ donationId: doacao.id, campaignId: doacao.campaignId, provider: intent.provider, refundedCents: intent.amountCents }),
    );
    await this.outbox.add(tx, {
      type: DONATION_EVENTS.refunded,
      aggregateType: 'donation',
      aggregateId: doacao.id,
      payload: { donationId: doacao.id, campaignId: doacao.campaignId, amountCents: doacao.amountCents },
    });
  }

  async onExpired(tx: Executor, intent: SettledIntent): Promise<void> {
    await tx
      .update(donations)
      .set({ status: 'EXPIRED', updatedAt: new Date() })
      .where(and(eq(donations.id, intent.referenceId), eq(donations.status, 'PENDING')));
  }

  async onFailed(tx: Executor, intent: SettledIntent): Promise<void> {
    await tx
      .update(donations)
      .set({ status: 'FAILED', updatedAt: new Date() })
      .where(and(eq(donations.id, intent.referenceId), inArray(donations.status, ['PENDING'])));
  }

  // --- Internos ------------------------------------------------------------------

  private async lockDonation(tx: Executor, donationId: string): Promise<DonationRow> {
    const [doacao] = await tx.select().from(donations).where(eq(donations.id, donationId)).for('update');
    if (!doacao) throw new Error(`Doação ${donationId} não encontrada ao liquidar pagamento`);
    return doacao;
  }

  private async findByKey(idempotencyKey: string): Promise<DonationRow | null> {
    const [doacao] = await this.db.select().from(donations).where(eq(donations.idempotencyKey, idempotencyKey)).limit(1);
    return doacao ?? null;
  }

  /** Mesma chave com dados diferentes é erro do cliente, não uma nova doação. */
  private async checkoutFor(existente: DonationRow, input: CreateDonation): Promise<DonationCheckout> {
    if (existente.campaignId !== input.campaignId || existente.amountCents !== input.amountCents) {
      throw new DomainError('IDEMPOTENCY_KEY_REUSED', 'Esta chave de idempotência já foi usada para outra doação', HttpStatus.CONFLICT);
    }
    return this.getCheckout(existente.id);
  }
}


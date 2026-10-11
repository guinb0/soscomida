import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { DB, type Database, type Executor } from '../../infra/db/db';
import { newId } from '../../infra/ids';
import { LEDGER_KINDS, type Posting, assertBalanced, balanceOf } from './domain/postings';
import { ledgerAccounts, ledgerEntries, ledgerTransactions } from './infra/ledger.schema';

export interface CampaignLedgerSummary {
  confirmedCents: number;
  feesCents: number;
  refundsCents: number;
  transfersCents: number;
  donationsCount: number;
}

@Injectable()
export class LedgerService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Grava uma transação balanceada. Idempotente pela `idempotencyKey`: se a
   * mesma transação já existe, nada é gravado e `created` volta `false`.
   * Deve ser chamada dentro da transação do caso de uso.
   */
  async post(executor: Executor, posting: Posting): Promise<{ transactionId: string; created: boolean }> {
    assertBalanced(posting);

    const id = newId();
    const inserida = await executor
      .insert(ledgerTransactions)
      .values({
        id,
        kind: posting.kind,
        idempotencyKey: posting.idempotencyKey,
        referenceType: posting.referenceType,
        referenceId: posting.referenceId,
        campaignId: posting.campaignId,
        description: posting.description,
      })
      .onConflictDoNothing({ target: ledgerTransactions.idempotencyKey })
      .returning({ id: ledgerTransactions.id });

    if (inserida.length === 0) {
      const [existente] = await executor
        .select({ id: ledgerTransactions.id })
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.idempotencyKey, posting.idempotencyKey));
      return { transactionId: existente!.id, created: false };
    }

    const contas = await this.ensureAccounts(executor, posting);
    await executor.insert(ledgerEntries).values(
      posting.lines.map((l) => ({
        id: newId(),
        transactionId: id,
        accountId: contas.get(l.accountCode)!,
        direction: l.direction,
        amountCents: l.amountCents,
      })),
    );
    return { transactionId: id, created: true };
  }

  /** Totais da campanha a partir dos lançamentos (fonte da verdade da projeção pública). */
  async campaignSummary(campaignId: string, executor: Executor = this.db): Promise<CampaignLedgerSummary> {
    const saldos = await executor
      .select({
        code: ledgerAccounts.code,
        kind: ledgerAccounts.kind,
        debits: sql<string>`coalesce(sum(case when ${ledgerEntries.direction} = 'DEBIT' then ${ledgerEntries.amountCents} else 0 end), 0)`,
        credits: sql<string>`coalesce(sum(case when ${ledgerEntries.direction} = 'CREDIT' then ${ledgerEntries.amountCents} else 0 end), 0)`,
      })
      .from(ledgerAccounts)
      .leftJoin(ledgerEntries, eq(ledgerEntries.accountId, ledgerAccounts.id))
      .where(eq(ledgerAccounts.campaignId, campaignId))
      .groupBy(ledgerAccounts.code, ledgerAccounts.kind);

    const saldo = (sufixo: string) => {
      const conta = saldos.find((s) => s.code === `campaign:${campaignId}:${sufixo}`);
      return conta ? balanceOf(conta.kind as Parameters<typeof balanceOf>[0], Number(conta.debits), Number(conta.credits)) : 0;
    };

    const contagem = await executor
      .select({ kind: ledgerTransactions.kind, total: count() })
      .from(ledgerTransactions)
      .where(
        and(
          eq(ledgerTransactions.campaignId, campaignId),
          inArray(ledgerTransactions.kind, [LEDGER_KINDS.donationConfirmed, LEDGER_KINDS.donationRefunded]),
        ),
      )
      .groupBy(ledgerTransactions.kind);
    const total = (kind: string) => contagem.find((c) => c.kind === kind)?.total ?? 0;

    return {
      confirmedCents: saldo('donations'),
      feesCents: saldo('fees'),
      refundsCents: saldo('refunds'),
      transfersCents: saldo('transfers'),
      donationsCount: total(LEDGER_KINDS.donationConfirmed) - total(LEDGER_KINDS.donationRefunded),
    };
  }

  /** Cria as contas que faltam e devolve o mapa código → id. */
  private async ensureAccounts(executor: Executor, posting: Posting): Promise<Map<string, string>> {
    const unicas = new Map(posting.lines.map((l) => [l.accountCode, l]));
    await executor
      .insert(ledgerAccounts)
      .values([...unicas.values()].map((l) => ({ id: newId(), code: l.accountCode, kind: l.accountKind, campaignId: l.campaignId })))
      .onConflictDoNothing({ target: ledgerAccounts.code });
    const linhas = await executor
      .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
      .from(ledgerAccounts)
      .where(inArray(ledgerAccounts.code, [...unicas.keys()]));
    return new Map(linhas.map((l) => [l.code, l.id]));
  }
}

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ModerationDecisionInput, ModerationQueueItem } from '@soscomida/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import { DB, type Database, isUniqueViolation } from '../../infra/db/db';
import { DomainError, forbidden } from '../../infra/http/errors';
import { newId } from '../../infra/ids';
import { type CampaignAction, CampaignsService } from '../campaigns';
import { type AuthContext, IdentityService } from '../identity';
import { moderationCases } from './infra/moderation.schema';

const DECISION_ACTIONS: Record<ModerationDecisionInput['decision'], CampaignAction> = {
  APPROVE: 'approve',
  REQUEST_CHANGES: 'request_changes',
  REJECT: 'reject',
};

@Injectable()
export class ModerationService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly campaigns: CampaignsService,
    private readonly identity: IdentityService,
  ) {}

  /** Campanhas aguardando ou em análise, mais antigas primeiro. */
  async queue(): Promise<ModerationQueueItem[]> {
    const pendentes = await this.campaigns.listByStatus(['PENDING_REVIEW', 'IN_REVIEW']);
    if (pendentes.length === 0) return [];

    const casos = await this.db
      .select()
      .from(moderationCases)
      .where(
        and(
          inArray(moderationCases.campaignId, pendentes.map((c) => c.id)),
          eq(moderationCases.kind, 'CAMPAIGN_REVIEW'),
          eq(moderationCases.status, 'OPEN'),
        ),
      );
    const casoPorCampanha = new Map(casos.map((c) => [c.campaignId, c]));
    const nomes = await this.identity.displayNames([
      ...pendentes.map((c) => c.organizerId),
      ...casos.map((c) => c.assignedTo).filter((id): id is string => !!id),
    ]);

    return pendentes.map((c) => {
      const caso = casoPorCampanha.get(c.id);
      return {
        caseId: caso?.id ?? c.id,
        campaignId: c.id,
        campaignTitle: c.title,
        campaignStatus: c.status as ModerationQueueItem['campaignStatus'],
        campaignVersion: c.version,
        organizerName: nomes.get(c.organizerId) ?? 'Organizador',
        goalCents: c.goalCents,
        openedAt: (caso?.openedAt ?? c.updatedAt).toISOString(),
        assignedTo: caso?.assignedTo ? { id: caso.assignedTo, name: nomes.get(caso.assignedTo) ?? 'Moderador' } : null,
      };
    });
  }

  /** Assume a análise: abre o caso e move a campanha para IN_REVIEW. */
  async claim(auth: AuthContext, campaignId: string, version: number): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(moderationCases).values({ id: newId(), campaignId, kind: 'CAMPAIGN_REVIEW', assignedTo: auth.userId });
        await this.campaigns.changeStatus(tx, campaignId, { action: 'claim', actor: 'moderator', actorUserId: auth.userId, expectedVersion: version });
      });
    } catch (error) {
      if (isUniqueViolation(error, 'moderation_cases_one_open')) {
        throw new DomainError('ALREADY_CLAIMED', 'Outro moderador já está analisando esta campanha', HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  /** Decide a análise. Só quem assumiu o caso decide (ou um admin). */
  async decide(auth: AuthContext, campaignId: string, input: ModerationDecisionInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [caso] = await tx
        .select()
        .from(moderationCases)
        .where(and(eq(moderationCases.campaignId, campaignId), eq(moderationCases.kind, 'CAMPAIGN_REVIEW'), eq(moderationCases.status, 'OPEN')))
        .for('update')
        .limit(1);
      if (!caso) throw new DomainError('NOT_CLAIMED', 'Assuma a análise antes de decidir', HttpStatus.CONFLICT);
      if (caso.assignedTo !== auth.userId && !auth.roles.includes('admin')) {
        throw forbidden('Esta análise está com outro moderador');
      }
      await this.campaigns.changeStatus(tx, campaignId, {
        action: DECISION_ACTIONS[input.decision],
        actor: 'moderator',
        actorUserId: auth.userId,
        expectedVersion: input.version,
        reason: input.reason,
      });
      await tx
        .update(moderationCases)
        .set({ status: 'CLOSED', decision: input.decision, reason: input.reason, closedAt: new Date() })
        .where(eq(moderationCases.id, caso.id));
    });
  }

  /** Investigação de campanha publicada (denúncia, inconsistência). */
  async investigate(auth: AuthContext, campaignId: string, version: number, reason: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.campaigns.changeStatus(tx, campaignId, { action: 'investigate', actor: 'moderator', actorUserId: auth.userId, expectedVersion: version, reason });
      await tx.insert(moderationCases).values({ id: newId(), campaignId, kind: 'INVESTIGATION', assignedTo: auth.userId, reason });
    });
  }

  async closeInvestigation(auth: AuthContext, campaignId: string, version: number, reason: string, outcome: 'CLEARED' | 'CANCELLED'): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.campaigns.changeStatus(tx, campaignId, {
        action: outcome === 'CLEARED' ? 'clear_investigation' : 'cancel_by_moderation',
        actor: 'moderator',
        actorUserId: auth.userId,
        expectedVersion: version,
        reason,
      });
      await tx
        .update(moderationCases)
        .set({ status: 'CLOSED', decision: outcome, reason, closedAt: new Date() })
        .where(and(eq(moderationCases.campaignId, campaignId), eq(moderationCases.kind, 'INVESTIGATION'), eq(moderationCases.status, 'OPEN')));
    });
  }
}

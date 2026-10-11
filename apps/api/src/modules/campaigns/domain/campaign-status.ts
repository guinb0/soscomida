import type { CampaignStatus } from '@soscomida/contracts';

/**
 * Máquina de estados das campanhas. Toda mudança de status passa por aqui;
 * transição fora desta tabela é recusada.
 *
 *   DRAFT ──submit──► PENDING_REVIEW ──claim──► IN_REVIEW ──approve──► APPROVED ──publish──► ACTIVE
 *     ▲                    │                       │  │                    │                 │  ▲
 *     └─────withdraw───────┘                       │  └─request_changes──► DRAFT             │  │ resume
 *                                                  └──reject──► CANCELLED                    ▼  │
 *                                                                                          PAUSED
 *   ACTIVE/PAUSED ──end──► ENDED (organizador ou prazo)
 *   ACTIVE/PAUSED/ENDED ──investigate──► UNDER_INVESTIGATION ──clear──► (status anterior)
 *                                                            └──cancel_by_moderation──► CANCELLED
 *   DRAFT/PENDING_REVIEW/APPROVED ──cancel──► CANCELLED (organizador; antes de receber doações)
 */
export type CampaignAction =
  | 'submit'
  | 'withdraw'
  | 'claim'
  | 'approve'
  | 'request_changes'
  | 'reject'
  | 'publish'
  | 'pause'
  | 'resume'
  | 'end'
  | 'expire'
  | 'cancel'
  | 'investigate'
  | 'clear_investigation'
  | 'cancel_by_moderation';

export type Actor = 'organizer' | 'moderator' | 'system';

interface Transition {
  from: readonly CampaignStatus[];
  /** `PREVIOUS` volta ao status anterior à investigação. */
  to: CampaignStatus | 'PREVIOUS';
  actors: readonly Actor[];
  requiresReason: boolean;
}

export const TRANSITIONS: Record<CampaignAction, Transition> = {
  submit: { from: ['DRAFT'], to: 'PENDING_REVIEW', actors: ['organizer'], requiresReason: false },
  withdraw: { from: ['PENDING_REVIEW'], to: 'DRAFT', actors: ['organizer'], requiresReason: false },
  claim: { from: ['PENDING_REVIEW'], to: 'IN_REVIEW', actors: ['moderator'], requiresReason: false },
  approve: { from: ['IN_REVIEW'], to: 'APPROVED', actors: ['moderator'], requiresReason: true },
  request_changes: { from: ['IN_REVIEW'], to: 'DRAFT', actors: ['moderator'], requiresReason: true },
  reject: { from: ['IN_REVIEW'], to: 'CANCELLED', actors: ['moderator'], requiresReason: true },
  publish: { from: ['APPROVED'], to: 'ACTIVE', actors: ['organizer'], requiresReason: false },
  pause: { from: ['ACTIVE'], to: 'PAUSED', actors: ['organizer'], requiresReason: true },
  resume: { from: ['PAUSED'], to: 'ACTIVE', actors: ['organizer'], requiresReason: false },
  end: { from: ['ACTIVE', 'PAUSED'], to: 'ENDED', actors: ['organizer'], requiresReason: true },
  expire: { from: ['ACTIVE', 'PAUSED'], to: 'ENDED', actors: ['system'], requiresReason: false },
  cancel: { from: ['DRAFT', 'PENDING_REVIEW', 'APPROVED'], to: 'CANCELLED', actors: ['organizer'], requiresReason: true },
  investigate: { from: ['ACTIVE', 'PAUSED', 'ENDED'], to: 'UNDER_INVESTIGATION', actors: ['moderator'], requiresReason: true },
  clear_investigation: { from: ['UNDER_INVESTIGATION'], to: 'PREVIOUS', actors: ['moderator'], requiresReason: true },
  cancel_by_moderation: { from: ['UNDER_INVESTIGATION'], to: 'CANCELLED', actors: ['moderator'], requiresReason: true },
};

export type TransitionResult =
  | { ok: true; to: CampaignStatus }
  | { ok: false; error: 'INVALID_TRANSITION' | 'ACTOR_NOT_ALLOWED' | 'REASON_REQUIRED' | 'NO_PREVIOUS_STATUS' };

export function transition(input: {
  action: CampaignAction;
  from: CampaignStatus;
  actor: Actor;
  reason?: string | null;
  /** Status anterior à investigação (vem do histórico). */
  previousStatus?: CampaignStatus | null;
}): TransitionResult {
  const regra = TRANSITIONS[input.action];
  if (!regra.from.includes(input.from)) return { ok: false, error: 'INVALID_TRANSITION' };
  if (!regra.actors.includes(input.actor)) return { ok: false, error: 'ACTOR_NOT_ALLOWED' };
  if (regra.requiresReason && !input.reason?.trim()) return { ok: false, error: 'REASON_REQUIRED' };

  if (regra.to === 'PREVIOUS') {
    const anterior = input.previousStatus;
    if (!anterior || !['ACTIVE', 'PAUSED', 'ENDED'].includes(anterior)) return { ok: false, error: 'NO_PREVIOUS_STATUS' };
    return { ok: true, to: anterior };
  }
  return { ok: true, to: regra.to };
}

/** Ações que este ator pode tentar a partir do status atual (para a interface). */
export function allowedActions(from: CampaignStatus, actor: Actor): CampaignAction[] {
  return (Object.keys(TRANSITIONS) as CampaignAction[]).filter((a) => {
    const regra = TRANSITIONS[a];
    return regra.from.includes(from) && regra.actors.includes(actor);
  });
}

/** Status em que a campanha aparece publicamente. */
export const PUBLIC_STATUSES: readonly CampaignStatus[] = ['ACTIVE', 'PAUSED', 'ENDED', 'UNDER_INVESTIGATION'];

/** Status em que o organizador ainda pode editar o conteúdo. */
export const EDITABLE_STATUSES: readonly CampaignStatus[] = ['DRAFT'];

export function acceptsDonations(status: CampaignStatus, endsAt: Date, now = new Date()): boolean {
  return status === 'ACTIVE' && endsAt.getTime() > now.getTime();
}

import { CAMPAIGN_STATUSES, type CampaignStatus } from '@soscomida/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type Actor, type CampaignAction, TRANSITIONS, acceptsDonations, allowedActions, transition } from './campaign-status';

const acoes = Object.keys(TRANSITIONS) as CampaignAction[];
const atores: Actor[] = ['organizer', 'moderator', 'system'];

describe('máquina de estados da campanha', () => {
  it('percorre o caminho feliz até ser encerrada', () => {
    const passos: [CampaignAction, Actor, CampaignStatus][] = [
      ['submit', 'organizer', 'PENDING_REVIEW'],
      ['claim', 'moderator', 'IN_REVIEW'],
      ['approve', 'moderator', 'APPROVED'],
      ['publish', 'organizer', 'ACTIVE'],
      ['pause', 'organizer', 'PAUSED'],
      ['resume', 'organizer', 'ACTIVE'],
      ['end', 'organizer', 'ENDED'],
    ];
    let status: CampaignStatus = 'DRAFT';
    for (const [action, actor, esperado] of passos) {
      const r = transition({ action, from: status, actor, reason: 'motivo registrado' });
      expect(r).toEqual({ ok: true, to: esperado });
      if (r.ok) status = r.to;
    }
  });

  it('organizador não aprova a própria campanha', () => {
    expect(transition({ action: 'approve', from: 'IN_REVIEW', actor: 'organizer', reason: 'quero' })).toEqual({ ok: false, error: 'ACTOR_NOT_ALLOWED' });
  });

  it('não publica sem aprovação', () => {
    expect(transition({ action: 'publish', from: 'PENDING_REVIEW', actor: 'organizer' })).toEqual({ ok: false, error: 'INVALID_TRANSITION' });
  });

  it('decisões de moderação exigem justificativa', () => {
    expect(transition({ action: 'reject', from: 'IN_REVIEW', actor: 'moderator', reason: '  ' })).toEqual({ ok: false, error: 'REASON_REQUIRED' });
  });

  it('encerrar a investigação devolve ao status anterior', () => {
    expect(transition({ action: 'clear_investigation', from: 'UNDER_INVESTIGATION', actor: 'moderator', reason: 'ok', previousStatus: 'PAUSED' })).toEqual({
      ok: true,
      to: 'PAUSED',
    });
    expect(transition({ action: 'clear_investigation', from: 'UNDER_INVESTIGATION', actor: 'moderator', reason: 'ok', previousStatus: 'DRAFT' })).toEqual({
      ok: false,
      error: 'NO_PREVIOUS_STATUS',
    });
  });

  it('campanha cancelada não sai do lugar (estado final)', () => {
    for (const actor of atores) expect(allowedActions('CANCELLED', actor)).toEqual([]);
  });

  it('nenhuma combinação leva a um status fora da lista (propriedade)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...acoes),
        fc.constantFrom(...CAMPAIGN_STATUSES),
        fc.constantFrom(...atores),
        fc.constantFrom(...CAMPAIGN_STATUSES),
        (action, from, actor, previousStatus) => {
          const r = transition({ action, from, actor, reason: 'motivo', previousStatus });
          if (r.ok) {
            expect(CAMPAIGN_STATUSES).toContain(r.to);
            expect(TRANSITIONS[action].from).toContain(from);
            expect(TRANSITIONS[action].actors).toContain(actor);
          }
        },
      ),
    );
  });

  it('só recebe doações ativa e dentro do prazo', () => {
    const futuro = new Date(Date.now() + 86_400_000);
    const passado = new Date(Date.now() - 1);
    expect(acceptsDonations('ACTIVE', futuro)).toBe(true);
    expect(acceptsDonations('ACTIVE', passado)).toBe(false);
    expect(acceptsDonations('PAUSED', futuro)).toBe(false);
  });
});

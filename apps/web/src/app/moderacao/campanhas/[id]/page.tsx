'use client';

import { CATEGORY_LABELS, type CampaignDetail, STATUS_LABELS } from '@soscomida/contracts';
import { formatBrl } from '@soscomida/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RequireSession } from '@/components/require-session';
import { Alert, Badge, Button, Card, Container, Label, PageTitle, Skeleton, Textarea } from '@/components/ui';
import { api, errorMessage, needsMfa } from '@/lib/api';

type CampanhaModeracao = CampaignDetail & { version: number };

export default function AnalisePage() {
  const { id } = useParams<{ id: string }>();
  return <RequireSession staff>{() => <Analise id={id} />}</RequireSession>;
}

function Analise({ id }: { id: string }) {
  const router = useRouter();
  const client = useQueryClient();
  const chave = ['moderation', 'campaign', id];
  const { data: c, isLoading, error } = useQuery({ queryKey: chave, queryFn: () => api<CampanhaModeracao>(`/moderation/campaigns/${id}`) });
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    if (needsMfa(error)) router.replace(`/seguranca?next=/moderacao/campanhas/${id}`);
  }, [error, router, id]);

  if (isLoading) return <Container className="py-10"><Skeleton className="h-96" /></Container>;
  if (error || !c) return <Container className="py-10">{!needsMfa(error) && <Alert tone="danger">{errorMessage(error)}</Alert>}</Container>;

  const agir = async (caminho: string, corpo: Record<string, unknown>, sucesso: string) => {
    setErro(null);
    setOk(null);
    try {
      await api(`/moderation/campaigns/${c.id}/${caminho}`, { method: 'POST', json: { version: c.version, ...corpo } });
      setOk(sucesso);
      setMotivo('');
      await client.invalidateQueries({ queryKey: chave });
      await client.invalidateQueries({ queryKey: ['moderation', 'queue'] });
    } catch (e) {
      if (needsMfa(e)) router.replace(`/seguranca?next=/moderacao/campanhas/${id}`);
      setErro(errorMessage(e));
    }
  };

  const totalOrcamento = c.budget.reduce((t, b) => t + b.plannedCents, 0);

  return (
    <Container className="py-10">
      <Badge tone="sun" className="mb-2">{STATUS_LABELS[c.status]}</Badge>
      <PageTitle title={c.title} subtitle={`${CATEGORY_LABELS[c.category]} · organizada por ${c.organizer.name}`} />

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="mb-2 font-display text-xl font-bold">Resumo</h2>
            <p className="text-ink-700">{c.summary}</p>
            <h2 className="mt-6 mb-2 font-display text-xl font-bold">Descrição</h2>
            <p className="whitespace-pre-line text-ink-700">{c.description}</p>
          </Card>
          <Card className="p-6">
            <h2 className="mb-3 font-display text-xl font-bold">Orçamento</h2>
            <ul className="space-y-1 text-sm">
              {c.budget.map((b) => (
                <li key={b.id} className="flex justify-between gap-4">
                  <span>{b.description}</span>
                  <span className="font-bold">{formatBrl(b.plannedCents)}</span>
                </li>
              ))}
            </ul>
            <p className={totalOrcamento === c.goalCents ? 'mt-3 text-sm font-bold text-melancia-700' : 'mt-3 text-sm font-bold text-maca-700'}>
              Total {formatBrl(totalOrcamento)} · meta {formatBrl(c.goalCents)}
            </p>
          </Card>
        </div>

        <aside>
          <Card className="space-y-4 p-6">
            <h2 className="font-display text-xl font-bold">Decisão</h2>
            {c.status === 'PENDING_REVIEW' && (
              <Button className="w-full" onClick={() => agir('claim', {}, 'Análise assumida. Só você pode decidir este caso.')}>
                Assumir análise
              </Button>
            )}
            {c.status === 'IN_REVIEW' && (
              <>
                <div>
                  <Label htmlFor="motivo">Justificativa (vai para o histórico e para o organizador)</Label>
                  <Textarea id="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                </div>
                <Button className="w-full" onClick={() => agir('decision', { decision: 'APPROVE', reason: motivo }, 'Campanha aprovada.')}>
                  Aprovar
                </Button>
                <Button variant="secondary" className="w-full" onClick={() => agir('decision', { decision: 'REQUEST_CHANGES', reason: motivo }, 'Ajustes solicitados.')}>
                  Pedir ajustes
                </Button>
                <Button variant="danger" className="w-full" onClick={() => agir('decision', { decision: 'REJECT', reason: motivo }, 'Campanha rejeitada.')}>
                  Rejeitar
                </Button>
              </>
            )}
            {['ACTIVE', 'PAUSED', 'ENDED'].includes(c.status) && (
              <>
                <div>
                  <Label htmlFor="motivo-inv">Motivo da investigação</Label>
                  <Textarea id="motivo-inv" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                </div>
                <Button variant="danger" className="w-full" onClick={() => agir('investigate', { reason: motivo }, 'Campanha sob investigação: doações suspensas.')}>
                  Abrir investigação
                </Button>
              </>
            )}
            {c.status === 'UNDER_INVESTIGATION' && (
              <>
                <div>
                  <Label htmlFor="motivo-fim">Conclusão</Label>
                  <Textarea id="motivo-fim" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                </div>
                <Button className="w-full" onClick={() => agir('close-investigation', { reason: motivo, outcome: 'CLEARED' }, 'Investigação encerrada.')}>
                  Encerrar sem irregularidade
                </Button>
                <Button variant="danger" className="w-full" onClick={() => agir('close-investigation', { reason: motivo, outcome: 'CANCELLED' }, 'Campanha cancelada.')}>
                  Cancelar campanha
                </Button>
              </>
            )}
            {ok && <Alert tone="success">{ok}</Alert>}
            {erro && <Alert tone="danger">{erro}</Alert>}
          </Card>
        </aside>
      </div>
    </Container>
  );
}

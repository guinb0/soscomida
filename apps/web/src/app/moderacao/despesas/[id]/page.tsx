'use client';

import { BUDGET_LABELS, EXPENSE_DOCUMENT_KIND_LABELS, FISCAL_CHECK_LABELS, type FiscalCheck, type ModerationExpense } from '@soscomida/contracts';
import { formatBrl, publicSupplierDocument } from '@soscomida/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ExpenseFlags, ExpenseSeals, ExpenseStatusBadge } from '@/components/expense-badges';
import { abrirDocumento } from '@/components/expense-documents';
import { RequireSession } from '@/components/require-session';
import { Alert, Button, Card, Container, Label, PageTitle, Select, Skeleton, Textarea } from '@/components/ui';
import { api, errorMessage, needsMfa } from '@/lib/api';
import { formatDate } from '@/lib/utils';

const MODELO = { NFE_55: 'NF-e', NFCE_65: 'NFC-e' } as const;

export default function RevisaoDespesaPage() {
  const { id } = useParams<{ id: string }>();
  return <RequireSession staff>{() => <Revisao id={id} />}</RequireSession>;
}

function Revisao({ id }: { id: string }) {
  const router = useRouter();
  const client = useQueryClient();
  const chave = ['moderation', 'expense', id];
  const { data: e, isLoading, error } = useQuery({ queryKey: chave, queryFn: () => api<ModerationExpense>(`/moderation/expenses/${id}`) });
  const [motivo, setMotivo] = useState('');
  const [pagamento, setPagamento] = useState<'' | 'ACCEPTED' | 'REJECTED'>('');
  const [entrega, setEntrega] = useState<'' | 'ACCEPTED' | 'REJECTED'>('');
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    if (needsMfa(error)) router.replace(`/seguranca?next=/moderacao/despesas/${id}`);
  }, [error, router, id]);

  if (isLoading) return <Container className="py-10"><Skeleton className="h-96" /></Container>;
  if (error || !e) return <Container className="py-10">{!needsMfa(error) && <Alert tone="danger">{errorMessage(error)}</Alert>}</Container>;

  const agir = async (caminho: string, corpo: Record<string, unknown>, sucesso: string) => {
    setErro(null);
    setOk(null);
    try {
      await api(`/moderation/expenses/${e.id}/${caminho}`, { method: 'POST', json: { version: e.version, ...corpo } });
      setOk(sucesso);
      await client.invalidateQueries({ queryKey: chave });
      await client.invalidateQueries({ queryKey: ['moderation', 'expenses'] });
    } catch (err) {
      setErro(errorMessage(err));
    }
  };
  const decidir = (decision: 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT', sucesso: string) =>
    agir('decision', { decision, reason: motivo, ...(pagamento ? { paymentProof: pagamento } : {}), ...(entrega ? { delivery: entrega } : {}) }, sucesso);

  const temComprovante = e.documents.some((d) => d.kind === 'PAYMENT_PROOF');
  const temEntrega = e.documents.some((d) => d.kind === 'DELIVERY');

  return (
    <Container className="py-10">
      <Link href="/moderacao/despesas" className="mb-4 inline-block text-sm font-bold text-sky-700 hover:underline">
        ← Fila de despesas
      </Link>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <ExpenseStatusBadge status={e.status} />
        <Link href={`/campanhas/${e.campaign.slug}`} className="text-sm font-bold text-sky-700 hover:underline">
          {e.campaign.title}
        </Link>
        <span className="text-sm text-ink-500">organizada por {e.organizerName}</span>
      </div>
      <PageTitle title={e.description} subtitle={`${formatBrl(e.amountCents)} · ${formatDate(`${e.spentOn}T12:00:00`)} · ${BUDGET_LABELS[e.budgetCategory]}`} />

      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card className="space-y-2 p-6 text-sm">
            <h2 className="font-display text-xl font-bold">Fornecedor e orçamento</h2>
            <p>
              {e.supplierName} {e.supplierDocument && <>· {publicSupplierDocument(e.supplierDocument)}</>}
            </p>
            <p>
              Categoria {BUDGET_LABELS[e.budgetCategory]}: planejado {formatBrl(e.budgetSituation.plannedCents)}, comprometido (enviadas e aprovadas){' '}
              <strong className={e.budgetSituation.committedCents > e.budgetSituation.plannedCents ? 'text-maca-700' : ''}>{formatBrl(e.budgetSituation.committedCents)}</strong>
            </p>
          </Card>

          <ExpenseFlags flags={e.flags} title="Alertas (recalculados agora)" />

          <Card className="p-6">
            <h2 className="mb-4 font-display text-xl font-bold">Documentos</h2>
            <ul className="space-y-4">
              {e.documents.map((d) => {
                const f = d.fiscalDocument;
                const v = (f && f.verificationStatus in FISCAL_CHECK_LABELS ? f.verificationStatus : 'NOT_VERIFIED') as FiscalCheck;
                return (
                  <li key={d.id} className="rounded-xl border border-line p-4 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>{EXPENSE_DOCUMENT_KIND_LABELS[d.kind]}</strong>
                      <Button variant="ghost" size="sm" onClick={() => void abrirDocumento(e.id, d.id).catch((err: unknown) => setErro(errorMessage(err)))}>
                        <ExternalLink className="size-4" aria-hidden /> Abrir arquivo
                      </Button>
                    </div>
                    {f && (
                      <div className="mt-2 space-y-1 text-ink-700">
                        <p>
                          {MODELO[f.model]} nº {f.number} série {f.series} · {f.uf} · emitente {f.issuerName ?? '—'} ({f.issuerDocument})
                        </p>
                        <p className="break-all font-mono text-xs text-ink-500">Chave: {f.accessKey}</p>
                        <p>
                          Total {f.effectiveTotalCents !== null ? formatBrl(f.effectiveTotalCents) : '—'} ({f.totalSource === 'DECLARED' ? 'declarado pelo organizador' : 'lido do documento'}) ·
                          nesta despesa {d.allocatedCents !== null ? formatBrl(d.allocatedCents) : '—'} · lida de {f.source === 'XML' ? 'XML' : f.source === 'QR_CODE' ? 'QR Code' : 'chave digitada'}
                        </p>
                        <p>
                          Consulta ao fisco: <strong>{FISCAL_CHECK_LABELS[v]}</strong>
                          {f.verificationReason && <span className="text-ink-500"> — {f.verificationReason}</span>}
                        </p>
                        {d.sharingJustification && <p>Rateio: {d.sharingJustification}</p>}
                        {f.items.length > 0 && (
                          <ul className="mt-1 divide-y divide-line">
                            {f.items.map((i, n) => (
                              <li key={n} className="flex justify-between gap-3 py-1">
                                <span>{i.description}</span>
                                <span>{formatBrl(i.totalCents)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-ink-500">Cada abertura de arquivo pela equipe fica registrada na auditoria.</p>
          </Card>
        </div>

        <aside>
          <Card className="space-y-4 p-6">
            <h2 className="font-display text-xl font-bold">Decisão</h2>
            <ExpenseSeals fiscal={e.fiscalCheck} paymentProof={e.paymentProof} delivery={e.delivery} />
            {e.status === 'SUBMITTED' && (
              <Button className="w-full" onClick={() => void agir('claim', {}, 'Revisão assumida. Só você pode decidir esta despesa.')}>
                Assumir revisão
              </Button>
            )}
            {e.status === 'IN_REVIEW' && (
              <>
                {temComprovante && (
                  <div>
                    <Label htmlFor="pagamento">Comprovante de pagamento</Label>
                    <Select id="pagamento" value={pagamento} onChange={(ev) => setPagamento(ev.target.value as typeof pagamento)}>
                      <option value="">Não avaliar agora</option>
                      <option value="ACCEPTED">Confere com a nota (valor, data, favorecido)</option>
                      <option value="REJECTED">Não confere</option>
                    </Select>
                  </div>
                )}
                {temEntrega && (
                  <div>
                    <Label htmlFor="entrega">Evidência de entrega</Label>
                    <Select id="entrega" value={entrega} onChange={(ev) => setEntrega(ev.target.value as typeof entrega)}>
                      <option value="">Não avaliar agora</option>
                      <option value="ACCEPTED">Comprova a entrega</option>
                      <option value="REJECTED">Não comprova</option>
                    </Select>
                  </div>
                )}
                <div>
                  <Label htmlFor="motivo">Justificativa (vai para o organizador e, se aprovada ou recusada, para a página pública)</Label>
                  <Textarea id="motivo" value={motivo} onChange={(ev) => setMotivo(ev.target.value)} />
                </div>
                <Button className="w-full" onClick={() => void decidir('APPROVE', 'Despesa aprovada.')}>
                  Aprovar
                </Button>
                <Button variant="secondary" className="w-full" onClick={() => void decidir('REQUEST_CHANGES', 'Ajustes pedidos ao organizador.')}>
                  Pedir ajustes
                </Button>
                <Button variant="danger" className="w-full" onClick={() => void decidir('REJECT', 'Despesa recusada.')}>
                  Recusar
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

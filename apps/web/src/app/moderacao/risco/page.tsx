'use client';

import {
  ADHERENCE_CLASSIFICATIONS,
  ADHERENCE_LABELS,
  EXPENSE_FLAGS,
  EXPENSE_FLAG_LABELS,
  type ExpenseFlag,
  type Me,
  FISCAL_CHECK_LABELS,
  RISK_FISCAL_KEYS,
  type RiskPolicy,
  type RiskPolicyRules,
} from '@soscomida/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RequireSession } from '@/components/require-session';
import { Alert, Button, Card, Container, Input, Label, PageTitle, Skeleton, Textarea } from '@/components/ui';
import { api, errorMessage, needsMfa } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

export default function PoliticaRiscoPage() {
  return <RequireSession staff>{(me) => <Politica me={me} />}</RequireSession>;
}

const nav = (
  <nav className="mb-6 flex flex-wrap gap-2" aria-label="Filas">
    <Link href="/moderacao" className="rounded-full border border-line-strong px-3 py-1 text-sm font-bold text-ink-700 hover:bg-paper-2">
      Campanhas
    </Link>
    <Link href="/moderacao/despesas" className="rounded-full border border-line-strong px-3 py-1 text-sm font-bold text-ink-700 hover:bg-paper-2">
      Despesas
    </Link>
    <span className="rounded-full bg-sky-100 px-3 py-1 text-sm font-bold text-sky-800">Política de risco</span>
  </nav>
);

function Politica({ me }: { me: Me }) {
  const router = useRouter();
  const [aviso, setAviso] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['moderation', 'risk-policy'],
    queryFn: () => api<{ current: RiskPolicy; history: RiskPolicy[] }>('/moderation/risk-policy'),
  });

  useEffect(() => {
    if (needsMfa(error)) router.replace('/seguranca?next=/moderacao/risco');
  }, [error, router]);

  return (
    <Container className="py-10">
      <PageTitle
        title="Política de risco"
        subtitle="Pontos de cada alerta e limites de risco usados para ordenar a fila de despesas. Cada mudança vira uma nova versão; análises antigas guardam a versão com que foram feitas."
      />
      {nav}
      {isLoading && <Skeleton className="h-96" />}
      {error && !needsMfa(error) && <Alert tone="danger">{errorMessage(error)}</Alert>}
      {aviso && (
        <Alert tone="success" className="mb-6">
          {aviso}
        </Alert>
      )}
      {data && <Editor key={data.current.version} politica={data.current} historico={data.history} podeEditar={me.roles.includes('admin')} onPublicada={setAviso} />}
    </Container>
  );
}

function Campo({ id, rotulo, valor, onChange, disabled }: { id: string; rotulo: string; valor: number; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-2 last:border-0">
      <Label htmlFor={id} className="mb-0 font-normal">
        {rotulo}
      </Label>
      <Input
        id={id}
        type="number"
        min={0}
        max={100}
        inputMode="numeric"
        className="w-20 shrink-0 text-right"
        value={valor}
        disabled={disabled}
        onChange={(e) => onChange(Math.max(0, Math.min(100, Math.trunc(Number(e.target.value) || 0))))}
      />
    </div>
  );
}

function Editor({
  politica,
  historico,
  podeEditar,
  onPublicada,
}: {
  politica: RiskPolicy;
  historico: RiskPolicy[];
  podeEditar: boolean;
  onPublicada: (aviso: string) => void;
}) {
  const client = useQueryClient();
  const [regras, setRegras] = useState<RiskPolicyRules>(politica.rules);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const travado = !podeEditar;

  const salvar = async () => {
    setErro(null);
    setSalvando(true);
    try {
      const nova = await api<RiskPolicy>('/moderation/risk-policy', { method: 'POST', json: { rules: regras, basedOnVersion: politica.version, reason: motivo } });
      onPublicada(`Versão ${nova.label} publicada. Vale para as próximas análises.`);
      await client.invalidateQueries({ queryKey: ['moderation', 'risk-policy'] });
    } catch (err) {
      setErro(errorMessage(err));
    } finally {
      setSalvando(false);
    }
  };

  const alternarDuro = (f: ExpenseFlag) =>
    setRegras((r) => ({ ...r, hardFlags: r.hardFlags.includes(f) ? r.hardFlags.filter((x) => x !== f) : [...r.hardFlags, f] }));

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        {travado && <Alert tone="sky">Só a administração pode publicar uma nova versão. Você está vendo a política vigente.</Alert>}

        <Card className="p-6">
          <h2 className="mb-1 font-display text-xl font-bold">Alertas automáticos</h2>
          <p className="mb-3 text-sm text-ink-600">Pontos somados quando o alerta aparece. Marque “risco alto direto” para sinais graves o bastante para pôr a despesa no topo da fila sozinhos.</p>
          {EXPENSE_FLAGS.map((f) => (
            <div key={f} className="flex flex-wrap items-center justify-between gap-x-4 border-b border-line last:border-0">
              <div className="min-w-0 flex-1">
                <Campo id={`flag-${f}`} rotulo={EXPENSE_FLAG_LABELS[f]} valor={regras.flagPoints[f]} disabled={travado} onChange={(v) => setRegras((r) => ({ ...r, flagPoints: { ...r.flagPoints, [f]: v } }))} />
              </div>
              <label className="flex items-center gap-1.5 pb-2 text-xs text-ink-600 sm:pb-0">
                <input type="checkbox" checked={regras.hardFlags.includes(f)} disabled={travado} onChange={() => alternarDuro(f)} /> risco alto direto
              </label>
            </div>
          ))}
        </Card>

        <Card className="p-6">
          <h2 className="mb-1 font-display text-xl font-bold">Consulta ao fisco</h2>
          <p className="mb-3 text-sm text-ink-600">Nota cancelada, não encontrada ou divergente é sempre risco alto; os pontos só ordenam dentro do grupo.</p>
          {RISK_FISCAL_KEYS.map((k) => (
            <Campo key={k} id={`fisco-${k}`} rotulo={FISCAL_CHECK_LABELS[k]} valor={regras.fiscalPoints[k]} disabled={travado} onChange={(v) => setRegras((r) => ({ ...r, fiscalPoints: { ...r.fiscalPoints, [k]: v } }))} />
          ))}
        </Card>

        <Card className="p-6">
          <h2 className="mb-1 font-display text-xl font-bold">Conclusão da IA</h2>
          <p className="mb-3 text-sm text-ink-600">A IA só soma pontos; nunca reduz o risco das regras.</p>
          {ADHERENCE_CLASSIFICATIONS.map((c) => (
            <Campo key={c} id={`ia-${c}`} rotulo={ADHERENCE_LABELS[c]} valor={regras.aiPoints[c]} disabled={travado} onChange={(v) => setRegras((r) => ({ ...r, aiPoints: { ...r.aiPoints, [c]: v } }))} />
          ))}
        </Card>
      </div>

      <aside className="space-y-4">
        <Card className="space-y-4 p-6">
          <h2 className="font-display text-xl font-bold">Limites</h2>
          <p className="text-sm text-ink-600">
            Vigente: <strong>{politica.label}</strong>
            {politica.createdAt && <> · {formatDateTime(politica.createdAt)}</>}
          </p>
          <Campo id="medio" rotulo="Risco médio a partir de" valor={regras.mediumFrom} disabled={travado} onChange={(v) => setRegras((r) => ({ ...r, mediumFrom: v }))} />
          <Campo id="alto" rotulo="Risco alto a partir de" valor={regras.highFrom} disabled={travado} onChange={(v) => setRegras((r) => ({ ...r, highFrom: v }))} />
          {podeEditar && (
            <>
              <div>
                <Label htmlFor="motivo">Motivo da mudança (fica no histórico e na auditoria)</Label>
                <Textarea id="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
              </div>
              <Button className="w-full" loading={salvando} disabled={motivo.trim().length < 10} onClick={() => void salvar()}>
                Publicar nova versão
              </Button>
              <p className="text-xs text-ink-500">Despesas já analisadas mantêm a pontuação; use “Refazer análise” na revisão para recalcular.</p>
            </>
          )}
          {erro && <Alert tone="danger">{erro}</Alert>}
        </Card>

        <Card className="p-6 text-sm">
          <h2 className="mb-3 font-display text-lg font-bold">Histórico</h2>
          <ol className="space-y-3">
            {historico.map((h) => (
              <li key={h.version}>
                <strong>{h.label}</strong>
                <span className="text-ink-500"> · {h.createdAt ? formatDateTime(h.createdAt) : 'padrão do sistema'}</span>
                {h.reason && <p className="text-ink-700">{h.reason}</p>}
              </li>
            ))}
          </ol>
        </Card>
      </aside>
    </div>
  );
}

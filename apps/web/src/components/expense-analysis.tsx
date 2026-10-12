import { ADHERENCE_LABELS, AI_STATUS_LABELS, type ExpenseAnalysis, RISK_LEVEL_LABELS, type RiskLevel } from '@soscomida/contracts';
import { Bot, Gauge, RefreshCw, ShieldAlert } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import { Badge, Button, Card } from './ui';

const RISK_TONE: Record<RiskLevel, 'success' | 'sun' | 'danger'> = { LOW: 'success', MEDIUM: 'sun', HIGH: 'danger' };

export function RiskBadge({ level, score }: { level: RiskLevel | null; score: number | null }) {
  if (!level || score === null) return <Badge tone="neutral">Análise pendente</Badge>;
  return (
    <Badge tone={RISK_TONE[level]}>
      {RISK_LEVEL_LABELS[level]} · {score}
    </Badge>
  );
}

const ORIGEM = { RULE: 'Regra', FISCAL: 'Fisco', AI: 'IA' } as const;

/**
 * Análise automática para quem revisa. A pontuação vem das regras; a IA só
 * soma pontos e explica. Nada aqui decide: a decisão é da pessoa.
 */
export function AnalysisPanel({ analysis, onReanalyze, busy }: { analysis: ExpenseAnalysis | null; onReanalyze: () => void; busy: boolean }) {
  return (
    <Card className="space-y-4 p-6 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold">
          <Gauge className="size-5" aria-hidden /> Análise automática
        </h2>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onReanalyze}>
          <RefreshCw className="size-4" aria-hidden /> {busy ? 'Analisando…' : 'Refazer análise'}
        </Button>
      </div>

      {!analysis && <p className="text-ink-600">Ainda não analisada (a análise roda em segundo plano depois do envio).</p>}

      {analysis && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <RiskBadge level={analysis.risk.level} score={analysis.risk.score} />
            <span className="text-xs text-ink-500">
              {formatDateTime(analysis.createdAt)} · regras {analysis.rulesetVersion} · {analysis.trigger === 'MANUAL' ? 'pedida pela revisão' : 'no envio'}
            </span>
          </div>

          {analysis.risk.factors.length > 0 && (
            <table className="w-full text-left">
              <caption className="sr-only">Fatores de risco</caption>
              <thead className="text-xs text-ink-500">
                <tr>
                  <th className="py-1 font-semibold">Fator</th>
                  <th className="py-1 font-semibold">Origem</th>
                  <th className="py-1 text-right font-semibold">Pontos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {analysis.risk.factors.map((f) => (
                  <tr key={f.code}>
                    <td className="py-1.5 pr-2">{f.label}</td>
                    <td className="py-1.5 pr-2 text-ink-500">{ORIGEM[f.source]}</td>
                    <td className="py-1.5 text-right tabular-nums">{f.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {analysis.suspiciousInstructions.length > 0 && (
            <div className="rounded-xl border border-maca-200 bg-maca-50 p-3 text-maca-800">
              <p className="mb-1 flex items-center gap-1.5 font-bold">
                <ShieldAlert className="size-4" aria-hidden /> Texto tentando dar ordens ao sistema
              </p>
              <ul className="space-y-1">
                {analysis.suspiciousInstructions.map((s, n) => (
                  <li key={n} className="break-words">
                    “{s.excerpt}”
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-xl border border-line p-3">
            <p className="mb-1 flex items-center gap-1.5 font-bold">
              <Bot className="size-4" aria-hidden /> Aderência à finalidade
            </p>
            {analysis.ai.output ? (
              <div className="space-y-2">
                <p>
                  <strong>{ADHERENCE_LABELS[analysis.ai.output.classification]}</strong>
                  <span className="text-ink-500"> · recomendação: {analysis.ai.output.recommendation === 'APPROVE' ? 'aprovar' : analysis.ai.output.recommendation === 'REVIEW' ? 'revisar' : 'considerar recusa'}</span>
                </p>
                <p className="text-ink-700">{analysis.ai.output.explanation}</p>
                {analysis.ai.output.detectedIssues.length > 0 && (
                  <ul className="list-inside list-disc text-ink-700">
                    {analysis.ai.output.detectedIssues.map((d, n) => (
                      <li key={n}>
                        {d.item && <strong>{d.item}: </strong>}
                        {d.detail}
                      </li>
                    ))}
                  </ul>
                )}
                {analysis.ai.output.missingEvidence.length > 0 && <p className="text-ink-600">Falta: {analysis.ai.output.missingEvidence.join('; ')}</p>}
              </div>
            ) : (
              <p className="text-ink-600">{AI_STATUS_LABELS[analysis.ai.status]}</p>
            )}
            <p className="mt-2 text-xs text-ink-500">
              {analysis.ai.simulated
                ? 'Simulador local de desenvolvimento (regras de palavras-chave), não é IA.'
                : `${analysis.ai.provider}${analysis.ai.model ? ` · ${analysis.ai.model}` : ''} · prompt ${analysis.ai.promptVersion}`}
            </p>
          </div>

          <p className="text-xs text-ink-500">A análise só orienta: aprovar ou recusar é decisão sua, com justificativa. Quando a IA diverge das regras, as regras prevalecem.</p>
        </>
      )}
    </Card>
  );
}

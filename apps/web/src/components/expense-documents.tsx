'use client';

import {
  EXPENSE_DOCUMENT_KINDS,
  EXPENSE_DOCUMENT_KIND_LABELS,
  type ExpenseDocument,
  type ExpenseDocumentKind,
  FISCAL_CHECK_LABELS,
  type FiscalCheck,
  type OwnedExpense,
} from '@soscomida/contracts';
import { formatBrl, onlyDigits, parseBrl, publicSupplierDocument } from '@soscomida/shared';
import { ExternalLink, FileText, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { ApiClientError, api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Alert, Badge, Button, Input, Label, Select, Textarea } from './ui';

const ACEITOS = 'application/xml,text/xml,.xml,application/pdf,image/jpeg,image/png,image/webp';
const TIPOS_PERMITIDOS = ['application/xml', 'application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
const MODELO = { NFE_55: 'NF-e', NFCE_65: 'NFC-e' } as const;

/** Navegadores às vezes informam XML como text/xml ou sem tipo. */
function tipoDoArquivo(f: File): (typeof TIPOS_PERMITIDOS)[number] | null {
  if (f.type === 'text/xml' || f.type === 'application/xml' || f.name.toLowerCase().endsWith('.xml')) return 'application/xml';
  return (TIPOS_PERMITIDOS as readonly string[]).includes(f.type) ? (f.type as (typeof TIPOS_PERMITIDOS)[number]) : null;
}

export async function abrirDocumento(expenseId: string, documentId: string) {
  const { url } = await api<{ url: string }>(`/expenses/${expenseId}/documents/${documentId}/url`);
  window.open(url, '_blank', 'noopener,noreferrer');
}

interface Rateio {
  fileId: string;
  kind: ExpenseDocumentKind;
  totalCents: number;
  allocatedElsewhereCents: number;
}

/** Envio de documentos e leitura automática da nota (XML, QR Code da foto ou chave digitada). */
export function ExpenseDocuments({ expense, onChange }: { expense: OwnedExpense; onChange: (e: OwnedExpense) => void }) {
  const editavel = expense.status === 'DRAFT';
  const [tipo, setTipo] = useState<ExpenseDocumentKind>('FISCAL');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [rateio, setRateio] = useState<Rateio | null>(null);
  const [justificativa, setJustificativa] = useState('');

  const anexar = async (fileId: string, kind: ExpenseDocumentKind, extra: Record<string, unknown> = {}) => {
    try {
      onChange(await api<OwnedExpense>(`/me/expenses/${expense.id}/documents`, { method: 'POST', json: { fileId, kind, ...extra } }));
      setRateio(null);
      setJustificativa('');
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'SHARING_JUSTIFICATION_REQUIRED') {
        const d = e.details as { totalCents: number; allocatedElsewhereCents: number };
        setRateio({ fileId, kind, ...d });
        return;
      }
      throw e;
    }
  };

  const enviar = async (arquivo: File) => {
    setErro(null);
    const contentType = tipoDoArquivo(arquivo);
    if (!contentType) {
      setErro('Envie XML, PDF ou foto (JPEG, PNG ou WebP).');
      return;
    }
    setEnviando(true);
    try {
      const ticket = await api<{ fileId: string; uploadUrl: string; headers: Record<string, string> }>(`/me/expenses/${expense.id}/documents/upload-url`, {
        method: 'POST',
        json: { contentType, sizeBytes: arquivo.size },
      });
      const put = await fetch(ticket.uploadUrl, { method: 'PUT', body: arquivo, headers: ticket.headers });
      if (!put.ok) throw new Error('Falha ao enviar o arquivo para o armazenamento.');
      await anexar(ticket.fileId, tipo);
    } catch (e) {
      setErro(e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : errorMessage(e));
    } finally {
      setEnviando(false);
    }
  };

  const remover = async (doc: ExpenseDocument) => {
    setErro(null);
    try {
      onChange(await api<OwnedExpense>(`/me/expenses/${expense.id}/documents/${doc.id}`, { method: 'DELETE' }));
    } catch (e) {
      setErro(errorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      {expense.documents.length === 0 && <p className="text-sm text-ink-600">Nenhum documento anexado.</p>}
      <ul className="space-y-3">
        {expense.documents.map((d) => (
          <li key={d.id} className="rounded-xl border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-bold text-ink-800">
                <FileText className="size-4" aria-hidden /> {EXPENSE_DOCUMENT_KIND_LABELS[d.kind]}
                <span className="text-xs font-normal text-ink-500">{d.mimeType.replace('application/', '').replace('image/', '')}</span>
              </span>
              <span className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => void abrirDocumento(expense.id, d.id).catch((e: unknown) => setErro(errorMessage(e)))}>
                  <ExternalLink className="size-4" aria-hidden /> Ver arquivo
                </Button>
                {editavel && (
                  <Button variant="ghost" size="sm" onClick={() => void remover(d)} aria-label="Remover documento">
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                )}
              </span>
            </div>
            <DadosFiscais expense={expense} doc={d} editavel={editavel} onChange={onChange} />
          </li>
        ))}
      </ul>

      {rateio && (
        <Alert tone="sun" title="Esta nota já está em outra despesa">
          <p>
            Total da nota: {formatBrl(rateio.totalCents)}. Já usado em outras despesas: {formatBrl(rateio.allocatedElsewhereCents)}. Para usar o restante
            aqui, explique a divisão (fica registrada para a revisão).
          </p>
          <Label htmlFor="justificativa-rateio" className="mt-3">
            Justificativa do rateio
          </Label>
          <Textarea id="justificativa-rateio" value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              loading={enviando}
              onClick={() => {
                setEnviando(true);
                anexar(rateio.fileId, rateio.kind, { sharingJustification: justificativa })
                  .catch((e: unknown) => setErro(errorMessage(e)))
                  .finally(() => setEnviando(false));
              }}
            >
              Anexar com rateio
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRateio(null)}>
              Desistir
            </Button>
          </div>
        </Alert>
      )}

      {editavel && (
        <div className="rounded-xl bg-paper-2 p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <Label htmlFor="tipo-documento">Tipo de documento</Label>
              <Select id="tipo-documento" value={tipo} onChange={(e) => setTipo(e.target.value as ExpenseDocumentKind)}>
                {EXPENSE_DOCUMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {EXPENSE_DOCUMENT_KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            </div>
            <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 font-bold text-white hover:bg-sky-700 aria-disabled:opacity-60" aria-disabled={enviando}>
              <Upload className="size-4" aria-hidden /> {enviando ? 'Enviando…' : 'Escolher arquivo'}
              <input
                type="file"
                accept={ACEITOS}
                className="sr-only"
                disabled={enviando}
                aria-label="Arquivo do documento"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void enviar(f);
                }}
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-ink-500">
            Nota fiscal: prefira o <strong>XML</strong> (lido por completo) ou a <strong>foto do cupom com o QR Code</strong>. PDF do DANFE pede a chave de acesso.
            Arquivos ficam privados: o público vê só os dados lidos da nota.
          </p>
        </div>
      )}
      {erro && <Alert tone="danger">{erro}</Alert>}
    </div>
  );
}

function DadosFiscais({ expense, doc, editavel, onChange }: { expense: OwnedExpense; doc: ExpenseDocument; editavel: boolean; onChange: (e: OwnedExpense) => void }) {
  const f = doc.fiscalDocument;
  if (doc.extraction.status === 'NEEDS_ACCESS_KEY' || doc.extraction.status === 'NEEDS_TOTAL') {
    return editavel ? <InformarChave expense={expense} doc={doc} onChange={onChange} /> : null;
  }
  if (!f) return null;
  const verificacao = (f.verificationStatus in FISCAL_CHECK_LABELS ? f.verificationStatus : 'NOT_VERIFIED') as FiscalCheck;
  return (
    <div className="mt-3 space-y-1 text-sm text-ink-700">
      <p>
        {MODELO[f.model]} nº {f.number} série {f.series} · {f.issuerName ?? 'emitente'} ({publicSupplierDocument(f.issuerDocument) ?? f.issuerDocument}) · {f.uf}
        {f.issuedAt && <> · emitida em {formatDate(f.issuedAt)}</>}
      </p>
      <p>
        Total da nota: <strong>{f.effectiveTotalCents !== null ? formatBrl(f.effectiveTotalCents) : '—'}</strong>
        {f.totalSource === 'DECLARED' && ' (informado por você)'} · nesta despesa: <strong>{doc.allocatedCents !== null ? formatBrl(doc.allocatedCents) : '—'}</strong>
      </p>
      {doc.sharingJustification && <p className="text-ink-600">Rateio: {doc.sharingJustification}</p>}
      <p className="flex flex-wrap items-center gap-2">
        <Badge tone={verificacao === 'AUTHORIZED' ? 'success' : ['CANCELLED', 'NOT_FOUND', 'DIVERGENT'].includes(verificacao) ? 'danger' : 'neutral'}>
          {FISCAL_CHECK_LABELS[verificacao]}
        </Badge>
        <span className="text-xs text-ink-500">Lida de: {f.source === 'XML' ? 'XML' : f.source === 'QR_CODE' ? 'QR Code' : 'chave digitada'}</span>
      </p>
      {f.items.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sky-700">{f.items.length} itens lidos da nota</summary>
          <ul className="mt-1 divide-y divide-line">
            {f.items.map((i, n) => (
              <li key={n} className="flex justify-between gap-3 py-1">
                <span>{i.description}</span>
                <span>{formatBrl(i.totalCents)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function InformarChave({ expense, doc, onChange }: { expense: OwnedExpense; doc: ExpenseDocument; onChange: (e: OwnedExpense) => void }) {
  const precisaChave = doc.extraction.status === 'NEEDS_ACCESS_KEY';
  const [chave, setChave] = useState(doc.fiscalDocument?.accessKey ?? '');
  const [total, setTotal] = useState('');
  const [justificativa, setJustificativa] = useState('');
  const [pedirJustificativa, setPedirJustificativa] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const salvar = async () => {
    setErro(null);
    let totalCents: number;
    try {
      totalCents = parseBrl(total);
    } catch {
      setErro('Informe o valor total da nota (ex.: 125,90).');
      return;
    }
    setEnviando(true);
    try {
      onChange(
        await api<OwnedExpense>(`/me/expenses/${expense.id}/documents/${doc.id}/fiscal-key`, {
          method: 'POST',
          json: { accessKey: onlyDigits(chave), declaredTotalCents: totalCents, ...(justificativa ? { sharingJustification: justificativa } : {}) },
        }),
      );
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'SHARING_JUSTIFICATION_REQUIRED') setPedirJustificativa(true);
      setErro(errorMessage(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-sun-300 bg-sun-50 p-3 text-sm">
      <p className="text-sun-800">{doc.extraction.message}</p>
      {precisaChave && (
        <div>
          <Label htmlFor={`chave-${doc.id}`}>Chave de acesso (44 dígitos)</Label>
          <Input id={`chave-${doc.id}`} inputMode="numeric" value={chave} onChange={(e) => setChave(e.target.value)} />
        </div>
      )}
      <div>
        <Label htmlFor={`total-${doc.id}`}>Valor total da nota (R$)</Label>
        <Input id={`total-${doc.id}`} inputMode="decimal" placeholder="0,00" value={total} onChange={(e) => setTotal(e.target.value)} />
      </div>
      {pedirJustificativa && (
        <div>
          <Label htmlFor={`just-${doc.id}`}>Justificativa do rateio</Label>
          <Textarea id={`just-${doc.id}`} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
        </div>
      )}
      {erro && <Alert tone="danger">{erro}</Alert>}
      <Button size="sm" loading={enviando} onClick={() => void salvar()}>
        Confirmar dados da nota
      </Button>
    </div>
  );
}

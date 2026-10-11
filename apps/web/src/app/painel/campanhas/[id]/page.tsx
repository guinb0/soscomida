'use client';

import { type ImageUploadTicket, type OwnedCampaign, STATUS_LABELS } from '@soscomida/contracts';
import { formatBrl } from '@soscomida/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, ImagePlus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { CampaignForm, toFormDefaults } from '@/components/campaign-form';
import { RequireSession } from '@/components/require-session';
import { Alert, Badge, Button, Card, Container, Input, Label, PageTitle, ProgressBar, Skeleton, Textarea, buttonClass } from '@/components/ui';
import { ApiClientError, api, errorMessage } from '@/lib/api';

const ACOES: Record<string, { label: string; motivo: boolean; variante: 'primary' | 'secondary' | 'danger'; ajuda?: string }> = {
  submit: { label: 'Enviar para análise', motivo: false, variante: 'primary', ajuda: 'A moderação confere a campanha antes de ela receber doações.' },
  withdraw: { label: 'Retirar da análise', motivo: false, variante: 'secondary' },
  publish: { label: 'Publicar e começar a receber doações', motivo: false, variante: 'primary' },
  pause: { label: 'Pausar doações', motivo: true, variante: 'secondary' },
  resume: { label: 'Retomar doações', motivo: false, variante: 'primary' },
  end: { label: 'Encerrar campanha', motivo: true, variante: 'danger' },
  cancel: { label: 'Cancelar campanha', motivo: true, variante: 'danger' },
};

export default function GerenciarCampanhaPage() {
  const { id } = useParams<{ id: string }>();
  return <RequireSession>{() => <Gerenciar id={id} />}</RequireSession>;
}

function Gerenciar({ id }: { id: string }) {
  const client = useQueryClient();
  const chave = ['me', 'campaign', id];
  const { data: c, isLoading, error } = useQuery({ queryKey: chave, queryFn: () => api<OwnedCampaign>(`/me/campaigns/${id}`) });
  const [erro, setErro] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [acaoPendente, setAcaoPendente] = useState<string | null>(null);

  if (isLoading) return <Container className="py-10"><Skeleton className="h-96" /></Container>;
  if (error || !c) return <Container className="py-10"><Alert tone="danger">{errorMessage(error)}</Alert></Container>;

  const atualizar = (nova: OwnedCampaign) => {
    client.setQueryData(chave, nova);
    void client.invalidateQueries({ queryKey: ['me', 'campaigns'] });
  };

  const executar = async (acao: string) => {
    setErro(null);
    if (ACOES[acao]?.motivo && acaoPendente !== acao) {
      setAcaoPendente(acao);
      return;
    }
    try {
      atualizar(await api<OwnedCampaign>(`/me/campaigns/${c.id}/actions/${acao}`, { method: 'POST', json: { version: c.version, reason: motivo || undefined } }));
      setAcaoPendente(null);
      setMotivo('');
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'VERSION_CONFLICT') await client.invalidateQueries({ queryKey: chave });
      setErro(errorMessage(e));
    }
  };

  const publica = ['ACTIVE', 'PAUSED', 'ENDED', 'UNDER_INVESTIGATION'].includes(c.status);

  return (
    <Container className="py-10">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <Badge tone={c.status === 'ACTIVE' ? 'success' : c.status === 'DRAFT' ? 'neutral' : 'sun'}>{STATUS_LABELS[c.status]}</Badge>
        {publica && (
          <Link href={`/campanhas/${c.slug}`} className="inline-flex items-center gap-1 text-sm font-bold text-sky-700 hover:underline">
            Ver página pública <ExternalLink className="size-4" aria-hidden />
          </Link>
        )}
      </div>
      <PageTitle title={c.title} />

      {c.moderationNote && (
        <Alert tone={c.status === 'DRAFT' || c.status === 'CANCELLED' ? 'sun' : 'sky'} title="Mensagem da moderação" className="mb-6">
          {c.moderationNote}
        </Alert>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-8">
          {c.status === 'DRAFT' ? (
            <>
              <Imagens campanha={c} onChange={atualizar} />
              <Card className="p-6">
                <h2 className="mb-4 font-display text-xl font-bold text-ink-900">Editar rascunho</h2>
                <CampaignForm
                  key={c.version}
                  initial={toFormDefaults(c)}
                  submitLabel="Salvar alterações"
                  onSubmit={async (input) => atualizar(await api<OwnedCampaign>(`/me/campaigns/${c.id}`, { method: 'PATCH', json: { ...input, version: c.version } }))}
                />
              </Card>
            </>
          ) : (
            <Card className="p-6">
              <p className="text-sm text-ink-600">
                O conteúdo só pode ser editado em rascunho. Mudanças de orçamento depois da aprovação passarão por nova análise (próxima etapa).
              </p>
            </Card>
          )}
          {publica && <NovaAtualizacao campaignId={c.id} />}
        </div>

        <aside className="space-y-4">
          <Card className="space-y-3 p-5">
            <p className="font-display text-2xl font-extrabold text-ink-900">{formatBrl(c.confirmedCents)}</p>
            <p className="text-sm text-ink-600">confirmados de {formatBrl(c.goalCents)}</p>
            <ProgressBar value={c.confirmedCents} max={c.goalCents} label="Progresso" />
            <p className="text-sm text-ink-600">{c.donationsCount} doações confirmadas</p>
          </Card>

          {publica && (
            <Card className="space-y-2 p-5">
              <h2 className="font-display text-lg font-bold text-ink-900">Prestação de contas</h2>
              <p className="text-sm text-ink-600">Registre os gastos com nota fiscal e comprovante. Eles aparecem na página pública depois de enviados.</p>
              <Link href={`/painel/campanhas/${c.id}/despesas`} className={buttonClass('primary', 'md', 'w-full')}>
                Despesas da campanha
              </Link>
            </Card>
          )}

          {c.allowedActions.length > 0 && (
            <Card className="space-y-3 p-5">
              <h2 className="font-display text-lg font-bold text-ink-900">Ações</h2>
              {c.allowedActions
                .filter((a) => ACOES[a])
                .map((a) => (
                  <div key={a} className="space-y-1">
                    <Button variant={ACOES[a]!.variante} className="w-full" onClick={() => executar(a)}>
                      {acaoPendente === a ? `Confirmar: ${ACOES[a]!.label.toLowerCase()}` : ACOES[a]!.label}
                    </Button>
                    {ACOES[a]!.ajuda && <p className="text-xs text-ink-500">{ACOES[a]!.ajuda}</p>}
                    {acaoPendente === a && (
                      <div>
                        <Label htmlFor={`motivo-${a}`}>Motivo (fica no histórico público da campanha)</Label>
                        <Textarea id={`motivo-${a}`} className="min-h-20" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                      </div>
                    )}
                  </div>
                ))}
              {erro && <Alert tone="danger">{erro}</Alert>}
            </Card>
          )}
        </aside>
      </div>
    </Container>
  );
}

/** Upload direto para o armazenamento por URL assinada; a API confere o arquivo depois. */
function Imagens({ campanha, onChange }: { campanha: OwnedCampaign; onChange: (c: OwnedCampaign) => void }) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const enviar = async (arquivo: File) => {
    setErro(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(arquivo.type)) return setErro('Use uma imagem JPG, PNG ou WebP.');
    if (arquivo.size > 8 * 1024 * 1024) return setErro('A imagem precisa ter até 8 MB.');
    setEnviando(true);
    try {
      const ticket = await api<ImageUploadTicket>(`/me/campaigns/${campanha.id}/images/upload-url`, {
        method: 'POST',
        json: { contentType: arquivo.type, sizeBytes: arquivo.size },
      });
      const put = await fetch(ticket.uploadUrl, { method: 'PUT', body: arquivo, headers: ticket.headers });
      if (!put.ok) throw new Error('Falha ao enviar a imagem para o armazenamento.');
      onChange(await api<OwnedCampaign>(`/me/campaigns/${campanha.id}/images/${ticket.fileId}`, { method: 'POST' }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : errorMessage(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Card className="p-6">
      <h2 className="mb-1 font-display text-xl font-bold text-ink-900">Imagens</h2>
      <p className="mb-4 text-sm text-ink-600">A primeira é a capa. Evite fotos que identifiquem crianças ou exponham dados pessoais.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {campanha.images.map(({ fileId, url }) => (
          <div key={fileId} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- bucket público */}
            <img src={url} alt="" className="aspect-video w-full rounded-xl object-cover" />
            <button
              type="button"
              className="absolute right-2 top-2 rounded-lg bg-surface/90 p-1.5 text-maca-700"
              aria-label="Remover imagem"
              onClick={async () => onChange(await api<OwnedCampaign>(`/me/campaigns/${campanha.id}/images/${fileId}`, { method: 'DELETE' }))}
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        ))}
        <label className="grid aspect-video cursor-pointer place-items-center rounded-xl border-2 border-dashed border-line-strong text-sm font-bold text-ink-600 hover:bg-paper-2">
          <span className="flex flex-col items-center gap-1">
            <ImagePlus className="size-6" aria-hidden />
            {enviando ? 'Enviando…' : 'Adicionar'}
          </span>
          <Input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="sr-only"
            disabled={enviando}
            onChange={(e) => {
              const arquivo = e.target.files?.[0];
              if (arquivo) void enviar(arquivo);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {erro && <Alert tone="danger" className="mt-3">{erro}</Alert>}
    </Card>
  );
}

function NovaAtualizacao({ campaignId }: { campaignId: string }) {
  const [titulo, setTitulo] = useState('');
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'erro'; msg: string } | null>(null);
  return (
    <Card className="space-y-3 p-6">
      <h2 className="font-display text-xl font-bold text-ink-900">Publicar atualização</h2>
      <div>
        <Label htmlFor="up-titulo">Título</Label>
        <Input id="up-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="up-texto">Texto</Label>
        <Textarea id="up-texto" value={texto} onChange={(e) => setTexto(e.target.value)} />
      </div>
      <Button
        onClick={async () => {
          try {
            await api(`/me/campaigns/${campaignId}/updates`, { method: 'POST', json: { title: titulo, body: texto } });
            setTitulo('');
            setTexto('');
            setEstado({ tipo: 'ok', msg: 'Atualização publicada.' });
          } catch (e) {
            setEstado({ tipo: 'erro', msg: errorMessage(e) });
          }
        }}
      >
        Publicar
      </Button>
      {estado && <Alert tone={estado.tipo === 'ok' ? 'success' : 'danger'}>{estado.msg}</Alert>}
      <p className="text-xs text-ink-500">
        As atualizações aparecem na página pública. <Link href="/transparencia" className="underline">Veja o que não publicar</Link>.
      </p>
    </Card>
  );
}

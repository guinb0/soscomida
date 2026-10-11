'use client';

import { DONATION_STATUS_LABELS, type DonationCheckout } from '@soscomida/contracts';
import { formatBrl } from '@soscomida/shared';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Copy } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Container, Skeleton, buttonClass } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

/**
 * Tela do Pix. Consulta o estado a cada 4 s até o provedor confirmar — o
 * navegador nunca marca a doação como paga por conta própria.
 */
export default function DoacaoPage() {
  const { id } = useParams<{ id: string }>();
  const [qr, setQr] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [simulando, setSimulando] = useState(false);
  const [erroSimulacao, setErroSimulacao] = useState<string | null>(null);

  const { data, error, isLoading } = useQuery({
    queryKey: ['donation', id],
    queryFn: () => api<DonationCheckout>(`/donations/${id}`),
    refetchInterval: (q) => (q.state.data?.status === 'PENDING' ? 4_000 : false),
  });

  const copyPaste = data?.pix?.copyPaste;
  useEffect(() => {
    if (!copyPaste) return;
    let ativo = true;
    void QRCode.toDataURL(copyPaste, { margin: 1, width: 280, errorCorrectionLevel: 'M' }).then((url) => ativo && setQr(url));
    return () => {
      ativo = false;
    };
  }, [copyPaste]);

  const copiar = async () => {
    if (!copyPaste) return;
    await navigator.clipboard.writeText(copyPaste);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2_000);
  };

  /** Só no ambiente de desenvolvimento: pede ao provedor falso para "pagar". */
  const simularPagamento = async () => {
    const ppid = copyPaste?.split('|')[1];
    if (!ppid) return;
    setSimulando(true);
    setErroSimulacao(null);
    try {
      await api(`/dev/payments/${encodeURIComponent(ppid)}/simulate`, { method: 'POST', json: { outcome: 'CONFIRMED' } });
    } catch (e) {
      setErroSimulacao(errorMessage(e));
    } finally {
      setSimulando(false);
    }
  };

  return (
    <Container className="max-w-xl py-10">
      {isLoading && <Skeleton className="h-96" />}
      {error && <Alert tone="danger">{errorMessage(error)}</Alert>}

      {data && (
        <Card className="p-6 text-center">
          <p className="text-sm font-bold text-ink-600">Sua doação</p>
          <p className="font-display text-4xl font-extrabold text-ink-900">{formatBrl(data.amountCents)}</p>
          <p className="mt-1 text-sm text-ink-600">{DONATION_STATUS_LABELS[data.status]}</p>

          {data.status === 'CONFIRMED' && (
            <div className="mt-6 space-y-4">
              <CheckCircle2 className="mx-auto size-16 text-melancia-600" aria-hidden />
              <p className="text-lg font-bold text-ink-900">Pagamento confirmado pelo banco. Obrigado!</p>
              <p className="text-sm text-ink-600">O valor já aparece no total da campanha. Você pode acompanhar a prestação de contas na página dela.</p>
              <Link href="/painel" className={buttonClass('primary')}>
                Ver minhas doações
              </Link>
            </div>
          )}

          {data.status === 'PENDING' && data.pix && (
            <div className="mt-6 space-y-4">
              {data.developmentOnly && (
                <Alert tone="sun" title="Ambiente de desenvolvimento">
                  Este QR Code não é pagável. Use o botão abaixo para simular o pagamento.
                </Alert>
              )}
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element -- QR gerado localmente (data URL)
                <img src={qr} alt="QR Code Pix para pagamento" className="mx-auto size-64 rounded-xl border border-line" />
              ) : (
                <Skeleton className="mx-auto size-64" />
              )}
              <p className="text-sm text-ink-600">Abra o app do seu banco, escolha Pix e leia o QR Code ou use o código copia e cola.</p>
              <div className="flex gap-2">
                <input readOnly value={data.pix.copyPaste} aria-label="Código Pix copia e cola" className="min-w-0 flex-1 truncate rounded-xl border border-line-strong bg-paper-2 px-3 text-sm" />
                <Button variant="secondary" onClick={copiar}>
                  <Copy className="size-4" aria-hidden /> {copiado ? 'Copiado' : 'Copiar'}
                </Button>
              </div>
              <p className="text-xs text-ink-500" aria-live="polite">
                Aguardando confirmação do banco… expira em {formatDateTime(data.pix.expiresAt)}.
              </p>
              {data.developmentOnly && (
                <>
                  <Button variant="donate" onClick={simularPagamento} loading={simulando} className="w-full">
                    Simular pagamento (desenvolvimento)
                  </Button>
                  {erroSimulacao && <Alert tone="danger">{erroSimulacao}</Alert>}
                </>
              )}
            </div>
          )}

          {(data.status === 'EXPIRED' || data.status === 'FAILED') && (
            <div className="mt-6 space-y-4">
              <Alert tone="neutral">Este Pix não foi pago a tempo. Nenhum valor foi cobrado.</Alert>
              <Link href="/campanhas" className={buttonClass('primary')}>
                Voltar às campanhas
              </Link>
            </div>
          )}

          {data.status === 'REFUNDED' && <Alert tone="neutral" className="mt-6">Esta doação foi estornada.</Alert>}
        </Card>
      )}
    </Container>
  );
}

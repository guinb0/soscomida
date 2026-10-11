'use client';

import type { MfaSetup } from '@soscomida/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { Suspense, useState } from 'react';
import { Alert, Button, Card, Container, Input, Label, Skeleton } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useMe, useRefreshSession } from '@/lib/session';
import { safeNext } from '@/lib/utils';

/**
 * Verificação em duas etapas (TOTP). Obrigatória para moderação e
 * administração: a API recusa esses papéis sem o código confirmado na sessão.
 */
function Seguranca() {
  const { data: me, isLoading } = useMe();
  const refresh = useRefreshSession();
  const router = useRouter();
  const params = useSearchParams();
  const [setup, setSetup] = useState<(MfaSetup & { qr: string }) | null>(null);
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (isLoading) return <Skeleton className="h-64" />;
  if (!me) {
    router.replace('/entrar?next=/seguranca');
    return null;
  }

  const iniciar = async () => {
    setErro(null);
    try {
      const dados = await api<MfaSetup>('/auth/mfa/setup', { method: 'POST' });
      setSetup({ ...dados, qr: await QRCode.toDataURL(dados.otpauthUri, { margin: 1, width: 220 }) });
    } catch (e) {
      setErro(errorMessage(e));
    }
  };

  const confirmar = async (rota: '/auth/mfa/enable' | '/auth/mfa/verify') => {
    setEnviando(true);
    setErro(null);
    try {
      await api(rota, { method: 'POST', json: { code: codigo } });
      await refresh();
      router.push(safeNext(params.get('next')));
    } catch (e) {
      setErro(errorMessage(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Card className="space-y-5 p-8">
      <h1 className="font-display text-3xl font-extrabold text-ink-900">Verificação em duas etapas</h1>

      {me.mfaEnabled ? (
        me.mfaVerified ? (
          <Alert tone="success">A verificação em duas etapas está ativa e confirmada nesta sessão.</Alert>
        ) : (
          <>
            <p className="text-ink-600">Digite o código de 6 dígitos do seu aplicativo autenticador para continuar.</p>
            <CampoCodigo valor={codigo} onChange={setCodigo} />
            <Button className="w-full" loading={enviando} onClick={() => confirmar('/auth/mfa/verify')}>
              Confirmar
            </Button>
          </>
        )
      ) : setup ? (
        <>
          <p className="text-ink-600">Leia o QR Code com um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, 1Password…).</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- QR gerado localmente */}
          <img src={setup.qr} alt="QR Code para o aplicativo autenticador" className="mx-auto size-56" />
          <p className="break-all text-center text-xs text-ink-500">
            Não consegue ler? Digite a chave: <code className="font-mono">{setup.secret}</code>
          </p>
          <CampoCodigo valor={codigo} onChange={setCodigo} />
          <Button className="w-full" loading={enviando} onClick={() => confirmar('/auth/mfa/enable')}>
            Ativar
          </Button>
        </>
      ) : (
        <>
          <p className="text-ink-600">Proteja sua conta exigindo um código do celular além da senha. Para moderadores e administradores é obrigatório.</p>
          <Button className="w-full" onClick={iniciar}>
            Configurar agora
          </Button>
        </>
      )}

      {erro && <Alert tone="danger">{erro}</Alert>}
    </Card>
  );
}

function CampoCodigo({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label htmlFor="codigo">Código do autenticador</Label>
      <Input
        id="codigo"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={valor}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        className="text-center font-mono text-2xl tracking-[0.5em]"
      />
    </div>
  );
}

export default function SegurancaPage() {
  return (
    <Container className="max-w-md py-14">
      <Suspense>
        <Seguranca />
      </Suspense>
    </Container>
  );
}

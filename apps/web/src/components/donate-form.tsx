'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type DonationCheckout, MAX_DONATION_CENTS, MIN_DONATION_CENTS, createDonationInputSchema } from '@soscomida/contracts';
import { InvalidMoneyError, formatBrl, parseBrl } from '@soscomida/shared';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/session';
import { cn } from '@/lib/utils';
import { Alert, Button, FieldError, Input, Label } from './ui';

const SUGESTOES = [2_000, 5_000, 10_000, 20_000];

const formSchema = z.object({
  valor: z.string().refine((v) => {
    try {
      const c = parseBrl(v);
      return c >= MIN_DONATION_CENTS && c <= MAX_DONATION_CENTS;
    } catch (e) {
      if (e instanceof InvalidMoneyError) return false;
      throw e;
    }
  }, `Informe um valor entre ${formatBrl(MIN_DONATION_CENTS)} e ${formatBrl(MAX_DONATION_CENTS)}`),
  displayName: z.string().max(60).optional(),
  anonymous: z.boolean(),
  payer: createDonationInputSchema.shape.payer,
});
type FormData = z.input<typeof formSchema>;

export function DonateForm({ campaignId, acceptsDonations }: { campaignId: string; acceptsDonations: boolean }) {
  const router = useRouter();
  const { data: me } = useMe();
  const [erro, setErro] = useState<string | null>(null);
  // Uma chave por tentativa: reenviar o mesmo formulário não cria outra cobrança.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { valor: '50,00', anonymous: false, payer: { name: '', cpf: '' } },
  });
  const valorAtual = useWatch({ control, name: 'valor' });

  if (!acceptsDonations) {
    return <Alert tone="neutral">Esta campanha não está recebendo doações no momento.</Alert>;
  }

  const enviar = handleSubmit(async (dados) => {
    setErro(null);
    try {
      const checkout = await api<DonationCheckout>('/donations', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        json: {
          campaignId,
          amountCents: parseBrl(dados.valor),
          displayName: dados.displayName || me?.name,
          anonymous: dados.anonymous,
          payer: dados.payer,
        },
      });
      router.push(`/doacao/${checkout.donationId}`);
    } catch (e) {
      setErro(errorMessage(e));
    }
  });

  return (
    <form onSubmit={enviar} className="space-y-4" noValidate>
      <fieldset>
        <legend className="mb-2 text-sm font-bold text-ink-800">Valor da doação</legend>
        <div className="mb-2 grid grid-cols-4 gap-2">
          {SUGESTOES.map((v) => {
            const texto = formatBrl(v).replace('R$', '').trim();
            return (
              <button
                key={v}
                type="button"
                onClick={() => setValue('valor', texto, { shouldValidate: true })}
                className={cn(
                  'rounded-xl border px-2 py-2 text-sm font-bold',
                  valorAtual === texto ? 'border-maca-500 bg-maca-50 text-maca-700' : 'border-line-strong text-ink-700 hover:bg-paper-2',
                )}
              >
                {formatBrl(v).replace(',00', '')}
              </button>
            );
          })}
        </div>
        <Label htmlFor="valor">Outro valor (R$)</Label>
        <Input id="valor" inputMode="decimal" aria-invalid={!!errors.valor} aria-describedby="valor-erro" {...register('valor')} />
        <FieldError id="valor-erro" message={errors.valor?.message} />
      </fieldset>

      <div>
        <Label htmlFor="payer-name">Nome do pagador</Label>
        <Input id="payer-name" autoComplete="name" aria-invalid={!!errors.payer?.name} {...register('payer.name')} />
        <FieldError message={errors.payer?.name?.message} />
      </div>
      <div>
        <Label htmlFor="payer-cpf">CPF do pagador</Label>
        <Input id="payer-cpf" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" aria-invalid={!!errors.payer?.cpf} aria-describedby="cpf-ajuda" {...register('payer.cpf')} />
        <p id="cpf-ajuda" className="mt-1 text-xs text-ink-500">
          Exigido pelo provedor Pix. Não é publicado nem guardado pela plataforma.
        </p>
        <FieldError message={errors.payer?.cpf?.message} />
      </div>

      <div>
        <Label htmlFor="displayName">Nome na lista de apoiadores (opcional)</Label>
        <Input id="displayName" placeholder={me?.name ?? 'Como quer aparecer'} {...register('displayName')} />
        <label className="mt-2 flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" className="size-4 accent-sky-600" {...register('anonymous')} /> Doar anonimamente
        </label>
      </div>

      {erro && <Alert tone="danger">{erro}</Alert>}

      <Button type="submit" variant="donate" size="lg" className="w-full" loading={isSubmitting}>
        Gerar Pix
      </Button>
    </form>
  );
}

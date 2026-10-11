'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  BUDGET_CATEGORIES,
  BUDGET_LABELS,
  CAMPAIGN_CATEGORIES,
  CATEGORY_LABELS,
  type CreateCampaignInput,
  type OwnedCampaign,
} from '@soscomida/contracts';
import { InvalidMoneyError, formatBrl, parseBrl } from '@soscomida/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Alert, Button, FieldError, Input, Label, Select, Textarea } from './ui';

const dinheiro = z.string().refine((v) => {
  try {
    return parseBrl(v) > 0;
  } catch (e) {
    if (e instanceof InvalidMoneyError) return false;
    throw e;
  }
}, 'Valor inválido (ex.: 1.234,56)');

const safeParse = (v: string) => {
  try {
    return parseBrl(v);
  } catch {
    return 0;
  }
};

const formSchema = z.object({
  title: z.string().trim().min(10, 'Título muito curto').max(120),
  summary: z.string().trim().min(20, 'Resumo com pelo menos 20 caracteres').max(280),
  description: z.string().trim().min(100, 'Descreva a causa com pelo menos 100 caracteres').max(20_000),
  category: z.enum(CAMPAIGN_CATEGORIES),
  goal: dinheiro,
  region: z.string().trim().max(120).optional(),
  endsAt: z.string().min(1, 'Informe o prazo'),
  budget: z
    .array(z.object({ category: z.enum(BUDGET_CATEGORIES), description: z.string().trim().min(3, 'Descreva o item').max(200), planned: dinheiro }))
    .min(1, 'Inclua ao menos um item'),
});
type FormData = z.infer<typeof formSchema>;

const paraTexto = (cents: number) => formatBrl(cents).replace('R$', '').trim();

export function toFormDefaults(c?: OwnedCampaign): FormData {
  if (!c) {
    return {
      title: '',
      summary: '',
      description: '',
      category: 'ALIMENTACAO',
      goal: '',
      region: '',
      endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      budget: [{ category: 'ALIMENTOS', description: '', planned: '' }],
    };
  }
  return {
    title: c.title,
    summary: c.summary,
    description: c.description,
    category: c.category,
    goal: paraTexto(c.goalCents),
    region: c.region ?? '',
    endsAt: c.endsAt.slice(0, 10),
    budget: c.budget.map((b) => ({ category: b.category, description: b.description, planned: paraTexto(b.plannedCents) })),
  };
}

export function CampaignForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial: FormData;
  submitLabel: string;
  onSubmit: (input: CreateCampaignInput) => Promise<void>;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(formSchema), defaultValues: initial });
  const { fields, append, remove } = useFieldArray({ control, name: 'budget' });

  const meta = safeParse(useWatch({ control, name: 'goal' }) ?? '');
  const somaOrcamento = (useWatch({ control, name: 'budget' }) ?? []).reduce((t, b) => t + safeParse(b.planned ?? ''), 0);
  const fecha = meta > 0 && meta === somaOrcamento;

  const enviar = handleSubmit(async (d) => {
    setErro(null);
    try {
      await onSubmit({
        title: d.title,
        summary: d.summary,
        description: d.description,
        category: d.category,
        goalCents: parseBrl(d.goal),
        region: d.region || null,
        // Fim do dia escolhido, no horário de Brasília.
        endsAt: new Date(`${d.endsAt}T23:59:00-03:00`).toISOString(),
        budget: d.budget.map((b) => ({ category: b.category, description: b.description, plannedCents: parseBrl(b.planned) })),
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.');
    }
  });

  return (
    <form onSubmit={enviar} className="space-y-6" noValidate>
      <div>
        <Label htmlFor="title">Título</Label>
        <Input id="title" aria-invalid={!!errors.title} {...register('title')} />
        <FieldError message={errors.title?.message} />
      </div>
      <div>
        <Label htmlFor="summary">Resumo (aparece nos cards)</Label>
        <Textarea id="summary" className="min-h-20" aria-invalid={!!errors.summary} {...register('summary')} />
        <FieldError message={errors.summary?.message} />
      </div>
      <div>
        <Label htmlFor="description">Descrição completa</Label>
        <Textarea id="description" className="min-h-48" aria-invalid={!!errors.description} {...register('description')} />
        <p className="mt-1 text-xs text-ink-500">Explique a causa, quem será ajudado e como o dinheiro será usado. Não publique CPF, endereço ou dados de saúde de terceiros.</p>
        <FieldError message={errors.description?.message} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="category">Categoria</Label>
          <Select id="category" {...register('category')}>
            {CAMPAIGN_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="goal">Meta (R$)</Label>
          <Input id="goal" inputMode="decimal" placeholder="15.000,00" aria-invalid={!!errors.goal} {...register('goal')} />
          <FieldError message={errors.goal?.message} />
        </div>
        <div>
          <Label htmlFor="endsAt">Prazo</Label>
          <Input id="endsAt" type="date" aria-invalid={!!errors.endsAt} {...register('endsAt')} />
          <FieldError message={errors.endsAt?.message} />
        </div>
      </div>
      <div>
        <Label htmlFor="region">Região (opcional, aproximada)</Label>
        <Input id="region" placeholder="Ex.: Ceilândia - DF" {...register('region')} />
      </div>

      <fieldset className="rounded-2xl border border-line p-4">
        <legend className="px-1 font-display text-lg font-bold text-ink-900">Orçamento planejado</legend>
        <p className="mb-4 text-sm text-ink-600">Divida a meta em categorias de gasto. As despesas da prestação de contas serão comparadas com este plano.</p>
        <div className="space-y-3">
          {fields.map((field, i) => (
            <div key={field.id} className="grid gap-2 sm:grid-cols-[180px_1fr_150px_auto] sm:items-start">
              <Select aria-label={`Categoria do item ${i + 1}`} {...register(`budget.${i}.category`)}>
                {BUDGET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {BUDGET_LABELS[c]}
                  </option>
                ))}
              </Select>
              <div>
                <Input aria-label={`Descrição do item ${i + 1}`} placeholder="Ex.: itens das cestas" {...register(`budget.${i}.description`)} />
                <FieldError message={errors.budget?.[i]?.description?.message} />
              </div>
              <div>
                <Input aria-label={`Valor do item ${i + 1}`} inputMode="decimal" placeholder="0,00" {...register(`budget.${i}.planned`)} />
                <FieldError message={errors.budget?.[i]?.planned?.message} />
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => remove(i)} disabled={fields.length === 1} aria-label={`Remover item ${i + 1}`}>
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
        </div>
        <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => append({ category: 'OUTROS', description: '', planned: '' })}>
          <Plus className="size-4" aria-hidden /> Adicionar item
        </Button>
        <p className={fecha ? 'mt-4 text-sm font-bold text-melancia-700' : 'mt-4 text-sm font-bold text-sun-700'} aria-live="polite">
          Soma do orçamento: {formatBrl(somaOrcamento)} {meta > 0 && (fecha ? '— fecha com a meta' : `— a meta é ${formatBrl(meta)}`)}
        </p>
        <FieldError message={errors.budget?.message ?? errors.budget?.root?.message} />
      </fieldset>

      {erro && <Alert tone="danger">{erro}</Alert>}
      <Button type="submit" size="lg" loading={isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}

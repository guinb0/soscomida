'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { BUDGET_CATEGORIES, BUDGET_LABELS, type BudgetCategory, type ExpenseInput } from '@soscomida/contracts';
import { InvalidMoneyError, formatBrl, isValidCnpj, isValidCpf, onlyDigits, parseBrl } from '@soscomida/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { errorMessage } from '@/lib/api';
import { Alert, Button, FieldError, Input, Label, Select } from './ui';

const valorValido = (v: string) => {
  try {
    return parseBrl(v) > 0;
  } catch (e) {
    if (e instanceof InvalidMoneyError) return false;
    throw e;
  }
};

const formSchema = z.object({
  budgetCategory: z.enum(BUDGET_CATEGORIES),
  description: z.string().trim().min(3, 'Descreva a despesa').max(300),
  supplierName: z.string().trim().min(2, 'Informe o fornecedor').max(160),
  supplierDocument: z
    .string()
    .trim()
    .refine((v) => {
      const d = onlyDigits(v);
      return d === '' || (d.length === 14 && isValidCnpj(d)) || (d.length === 11 && isValidCpf(d));
    }, 'CNPJ ou CPF inválido'),
  valor: z.string().trim().refine(valorValido, 'Valor inválido (ex.: 125,90)'),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data'),
});
type FormData = z.infer<typeof formSchema>;

export function toExpenseFormDefaults(e?: Partial<ExpenseInput> & { amountCents?: number }): FormData {
  return {
    budgetCategory: (e?.budgetCategory ?? 'ALIMENTOS') as BudgetCategory,
    description: e?.description ?? '',
    supplierName: e?.supplierName ?? '',
    supplierDocument: e?.supplierDocument ?? '',
    valor: e?.amountCents ? formatBrl(e.amountCents).replace(/^R\$\s*/, '') : '',
    spentOn: e?.spentOn ?? new Date().toISOString().slice(0, 10),
  };
}

export function ExpenseForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial: FormData;
  submitLabel: string;
  onSubmit: (input: ExpenseInput) => Promise<void>;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(formSchema), defaultValues: initial });

  const enviar = handleSubmit(async (d) => {
    setErro(null);
    try {
      await onSubmit({
        budgetCategory: d.budgetCategory,
        description: d.description,
        supplierName: d.supplierName,
        supplierDocument: onlyDigits(d.supplierDocument) || null,
        amountCents: parseBrl(d.valor),
        spentOn: d.spentOn,
      });
    } catch (e) {
      setErro(errorMessage(e));
    }
  });

  return (
    <form onSubmit={enviar} className="space-y-4" noValidate>
      <div>
        <Label htmlFor="description">O que foi comprado ou contratado</Label>
        <Input id="description" placeholder="Ex.: arroz e feijão para 50 cestas" aria-invalid={!!errors.description} {...register('description')} />
        <FieldError message={errors.description?.message} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="budgetCategory">Categoria do orçamento</Label>
          <Select id="budgetCategory" {...register('budgetCategory')}>
            {BUDGET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {BUDGET_LABELS[c]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="valor">Valor (R$)</Label>
          <Input id="valor" inputMode="decimal" placeholder="0,00" aria-invalid={!!errors.valor} {...register('valor')} />
          <FieldError message={errors.valor?.message} />
        </div>
        <div>
          <Label htmlFor="spentOn">Data da compra</Label>
          <Input id="spentOn" type="date" aria-invalid={!!errors.spentOn} {...register('spentOn')} />
          <FieldError message={errors.spentOn?.message} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="supplierName">Fornecedor</Label>
          <Input id="supplierName" aria-invalid={!!errors.supplierName} {...register('supplierName')} />
          <FieldError message={errors.supplierName?.message} />
        </div>
        <div>
          <Label htmlFor="supplierDocument">CNPJ ou CPF do fornecedor (opcional)</Label>
          <Input id="supplierDocument" inputMode="numeric" aria-invalid={!!errors.supplierDocument} {...register('supplierDocument')} />
          <FieldError message={errors.supplierDocument?.message} />
          <p className="mt-1 text-xs text-ink-500">CPF de pessoa física nunca é publicado sem máscara.</p>
        </div>
      </div>
      {erro && <Alert tone="danger">{erro}</Alert>}
      <Button type="submit" loading={isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}

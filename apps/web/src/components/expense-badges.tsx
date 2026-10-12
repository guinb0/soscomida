import {
  type Assessment,
  EXPENSE_FLAG_LABELS,
  EXPENSE_STATUS_LABELS,
  type ExpenseFlag,
  type ExpenseDocument,
  type ExpenseStatus,
  FISCAL_CHECK_LABELS,
  type FiscalCheck,
} from '@soscomida/contracts';
import { AlertTriangle, BadgeCheck, CircleDashed, FileSignature, FileWarning, PackageCheck, Receipt, ShieldX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from './ui';

const STATUS_TONE: Record<ExpenseStatus, 'neutral' | 'sky' | 'sun' | 'success' | 'danger'> = {
  DRAFT: 'neutral',
  SUBMITTED: 'sun',
  IN_REVIEW: 'sun',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

export function ExpenseStatusBadge({ status }: { status: ExpenseStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{EXPENSE_STATUS_LABELS[status]}</Badge>;
}

const FISCAL_TONE: Record<FiscalCheck, string> = {
  NONE: 'border-line-strong text-ink-600',
  NOT_VERIFIED: 'border-line-strong text-ink-600',
  UNVERIFIABLE: 'border-sun-300 bg-sun-50 text-sun-800',
  AUTHORIZED: 'border-melancia-200 bg-melancia-50 text-melancia-800',
  NOT_FOUND: 'border-maca-200 bg-maca-50 text-maca-800',
  DIVERGENT: 'border-maca-200 bg-maca-50 text-maca-800',
  CANCELLED: 'border-maca-200 bg-maca-50 text-maca-800',
};

const ASSESSMENT_TEXT: Record<'paymentProof' | 'delivery', Record<Assessment, string>> = {
  paymentProof: { NONE: 'Sem comprovante de pagamento', ATTACHED: 'Comprovante enviado (não conferido)', ACCEPTED: 'Pagamento conferido', REJECTED: 'Comprovante recusado' },
  delivery: { NONE: 'Sem evidência de entrega', ATTACHED: 'Evidência de entrega enviada', ACCEPTED: 'Entrega comprovada', REJECTED: 'Evidência de entrega recusada' },
};

function Selo({ tom, icone: Icone, texto }: { tom: string; icone: typeof BadgeCheck; texto: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold', tom)}>
      <Icone className="size-3.5" aria-hidden /> {texto}
    </span>
  );
}

/**
 * Os três selos independentes de uma despesa. Nunca um "verificado" genérico:
 * cada um responde uma pergunta diferente (docs/FISCAL_VALIDATION.md).
 */
export function ExpenseSeals({ fiscal, paymentProof, delivery }: { fiscal: FiscalCheck; paymentProof: Assessment; delivery: Assessment }) {
  const tomAvaliacao = (a: Assessment) =>
    a === 'ACCEPTED' ? 'border-melancia-200 bg-melancia-50 text-melancia-800' : a === 'REJECTED' ? 'border-maca-200 bg-maca-50 text-maca-800' : 'border-line-strong text-ink-600';
  return (
    <div className="flex flex-wrap gap-1.5">
      <Selo
        tom={FISCAL_TONE[fiscal]}
        icone={fiscal === 'AUTHORIZED' ? BadgeCheck : fiscal === 'UNVERIFIABLE' || fiscal === 'NOT_VERIFIED' || fiscal === 'NONE' ? CircleDashed : ShieldX}
        texto={FISCAL_CHECK_LABELS[fiscal]}
      />
      <Selo tom={tomAvaliacao(paymentProof)} icone={Receipt} texto={ASSESSMENT_TEXT.paymentProof[paymentProof]} />
      <Selo tom={tomAvaliacao(delivery)} icone={PackageCheck} texto={ASSESSMENT_TEXT.delivery[delivery]} />
    </div>
  );
}

export function ExpenseFlags({ flags, title = 'Alertas automáticos' }: { flags: ExpenseFlag[]; title?: string }) {
  if (flags.length === 0) return null;
  return (
    <div className="rounded-xl border border-sun-300 bg-sun-50 p-4 text-sm">
      <p className="mb-2 flex items-center gap-1.5 font-bold text-sun-800">
        <AlertTriangle className="size-4" aria-hidden /> {title}
      </p>
      <ul className="space-y-1 text-sun-800">
        {flags.map((f) => (
          <li key={f} className="flex gap-1.5">
            <FileWarning className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {EXPENSE_FLAG_LABELS[f]}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-sun-800">Alertas não reprovam a despesa sozinhos: orientam a revisão humana.</p>
    </div>
  );
}

type Signature = NonNullable<NonNullable<ExpenseDocument['fiscalDocument']>['signature']>;

/**
 * Assinatura digital do XML. "Íntegra" quer dizer que o arquivo não foi
 * alterado depois de assinado — não que a nota seja autêntica no fisco, nem
 * que o certificado seja ICP-Brasil (a cadeia não é validada).
 */
export function SignatureLine({ signature, showSubject = false }: { signature: Signature; showSubject?: boolean }) {
  const texto =
    signature.status === 'VALID'
      ? signature.problems.length
        ? 'Assinatura íntegra, mas o certificado não confere'
        : 'Assinatura digital íntegra (arquivo não alterado depois de assinado)'
      : signature.status === 'MISSING'
        ? 'XML sem assinatura digital'
        : 'Assinatura digital inválida: arquivo alterado ou montado';
  const ruim = signature.status !== 'VALID' || signature.problems.length > 0;
  return (
    <div className={cn('flex gap-1.5', ruim ? 'text-maca-700' : 'text-melancia-800')}>
      <FileSignature className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {texto}
        {signature.problems.length > 0 && signature.status === 'VALID' && <>: {signature.problems.join('; ')}</>}
        {showSubject && signature.certificateSubject && <span className="block text-xs text-ink-500">Certificado: {signature.certificateSubject}</span>}
      </span>
    </div>
  );
}

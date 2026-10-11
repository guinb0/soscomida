import { type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type LabelHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

/*
 * Componentes de interface no estilo shadcn/ui: Tailwind puro, acessíveis,
 * sem dependência de biblioteca de componentes.
 */

type ButtonVariant = 'primary' | 'donate' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-sky-600 text-white hover:bg-sky-700 shadow-soft',
  donate: 'bg-maca-600 text-white hover:bg-maca-700 shadow-soft',
  secondary: 'bg-surface text-ink-800 border border-line-strong hover:bg-paper-2',
  ghost: 'text-ink-700 hover:bg-paper-2',
  danger: 'bg-surface text-maca-700 border border-maca-200 hover:bg-maca-50',
};
const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-5 text-base',
  lg: 'h-13 px-7 text-lg',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string) {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-xl font-bold transition-colors disabled:opacity-50 disabled:pointer-events-none',
    buttonVariants[variant],
    buttonSizes[size],
    extra,
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }>(
  ({ variant, size, loading, className, children, disabled, ...props }, ref) => (
    <button ref={ref} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading} {...props}>
      {loading && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-[var(--radius-card)] border border-line bg-surface shadow-soft', className)} {...props} />;
}

type BadgeTone = 'neutral' | 'sky' | 'sun' | 'success' | 'danger';
const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-ink-100 text-ink-700',
  sky: 'bg-sky-100 text-sky-800',
  sun: 'bg-sun-100 text-sun-800',
  success: 'bg-melancia-100 text-melancia-800',
  danger: 'bg-maca-100 text-maca-800',
};
export function Badge({ tone = 'neutral', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold', badgeTones[tone], className)} {...props} />;
}

export const Label = ({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) => (
  <label className={cn('mb-1.5 block text-sm font-bold text-ink-800', className)} {...props} />
);

const fieldClass =
  'w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-ink-900 placeholder:text-ink-400 focus:border-sky-500 focus:outline-none focus:ring-3 focus:ring-sky-100 aria-[invalid=true]:border-maca-500';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldClass, className)} {...props} />
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldClass, 'min-h-28', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(fieldClass, 'appearance-none bg-surface', className)} {...props} />
));
Select.displayName = 'Select';

export function FieldError({ message, id }: { message?: string; id?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-sm font-semibold text-maca-700">
      {message}
    </p>
  );
}

export function Alert({ tone = 'sky', title, children, className }: { tone?: BadgeTone; title?: string; children: React.ReactNode; className?: string }) {
  const tons: Record<BadgeTone, string> = {
    neutral: 'border-line bg-paper-2 text-ink-800',
    sky: 'border-sky-200 bg-sky-50 text-sky-900',
    sun: 'border-sun-200 bg-sun-50 text-sun-800',
    success: 'border-melancia-200 bg-melancia-50 text-melancia-800',
    danger: 'border-maca-200 bg-maca-50 text-maca-800',
  };
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('rounded-xl border px-4 py-3 text-sm', tons[tone], className)}>
      {title && <p className="mb-0.5 font-bold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.floor((value * 100) / max)) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-2.5 w-full overflow-hidden rounded-full bg-ink-100">
      <div className="h-full rounded-full bg-gradient-to-r from-melancia-500 to-sky-500 transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-ink-100', className)} aria-hidden />;
}

export function Container({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mx-auto w-full max-w-6xl px-4 sm:px-6', className)} {...props} />;
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="font-display text-3xl font-extrabold text-ink-900 sm:text-4xl">{title}</h1>
      {subtitle && <p className="mt-1 text-ink-600">{subtitle}</p>}
    </div>
  );
}

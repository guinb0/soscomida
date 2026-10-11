'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type LoginInput, loginInputSchema } from '@soscomida/contracts';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Button, Card, Container, FieldError, Input, Label } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useRefreshSession } from '@/lib/session';
import { safeNext } from '@/lib/utils';

function FormularioLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const refresh = useRefreshSession();
  const [erro, setErro] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginInputSchema) });

  const entrar = handleSubmit(async (dados) => {
    setErro(null);
    try {
      await api('/auth/login', { method: 'POST', json: dados });
      await refresh();
      router.push(safeNext(params.get('next')));
    } catch (e) {
      setErro(errorMessage(e));
    }
  });

  return (
    <form onSubmit={entrar} className="space-y-4" noValidate>
      <div>
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register('email')} />
        <FieldError message={errors.email?.message} />
      </div>
      <div>
        <Label htmlFor="password">Senha</Label>
        <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...register('password')} />
        <FieldError message={errors.password?.message} />
      </div>
      {erro && <Alert tone="danger">{erro}</Alert>}
      <Button type="submit" className="w-full" loading={isSubmitting}>
        Entrar
      </Button>
    </form>
  );
}

export default function EntrarPage() {
  return (
    <Container className="max-w-md py-14">
      <Card className="p-8">
        <h1 className="mb-6 font-display text-3xl font-extrabold text-ink-900">Entrar</h1>
        <Suspense>
          <FormularioLogin />
        </Suspense>
        <p className="mt-6 text-center text-sm text-ink-600">
          Ainda não tem conta?{' '}
          <Link href="/cadastrar" className="font-bold text-sky-700 hover:underline">
            Criar conta
          </Link>
        </p>
      </Card>
    </Container>
  );
}

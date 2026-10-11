'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type RegisterInput, registerInputSchema } from '@soscomida/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Alert, Button, Card, Container, FieldError, Input, Label } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useRefreshSession } from '@/lib/session';

export default function CadastrarPage() {
  const router = useRouter();
  const refresh = useRefreshSession();
  const [erro, setErro] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof registerInputSchema>, unknown, RegisterInput>({ resolver: zodResolver(registerInputSchema) });

  const cadastrar = handleSubmit(async (dados) => {
    setErro(null);
    try {
      await api('/auth/register', { method: 'POST', json: dados });
      await refresh();
      router.push('/painel');
    } catch (e) {
      setErro(errorMessage(e));
    }
  });

  return (
    <Container className="max-w-md py-14">
      <Card className="p-8">
        <h1 className="mb-1 font-display text-3xl font-extrabold text-ink-900">Criar conta</h1>
        <p className="mb-6 text-sm text-ink-600">Para acompanhar suas doações ou criar uma campanha.</p>
        <form onSubmit={cadastrar} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="name">Nome</Label>
            <Input id="name" autoComplete="name" aria-invalid={!!errors.name} {...register('name')} />
            <FieldError message={errors.name?.message} />
          </div>
          <div>
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register('email')} />
            <FieldError message={errors.email?.message} />
          </div>
          <div>
            <Label htmlFor="password">Senha</Label>
            <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} aria-describedby="senha-ajuda" {...register('password')} />
            <p id="senha-ajuda" className="mt-1 text-xs text-ink-500">
              Pelo menos 10 caracteres. Uma frase fácil de lembrar funciona bem.
            </p>
            <FieldError message={errors.password?.message} />
          </div>
          {erro && <Alert tone="danger">{erro}</Alert>}
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Criar conta
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-ink-600">
          Já tem conta?{' '}
          <Link href="/entrar" className="font-bold text-sky-700 hover:underline">
            Entrar
          </Link>
        </p>
      </Card>
    </Container>
  );
}

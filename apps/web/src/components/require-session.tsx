'use client';

import type { Me } from '@soscomida/contracts';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { isStaff, useMe } from '@/lib/session';
import { Container, Skeleton } from './ui';

/**
 * Conveniência de interface: manda para o login quem não tem sessão. A
 * permissão de verdade é sempre conferida pela API.
 */
export function RequireSession({ staff = false, children }: { staff?: boolean; children: (me: Me) => React.ReactNode }) {
  const { data: me, isLoading } = useMe();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isLoading) return;
    if (!me) router.replace(`/entrar?next=${encodeURIComponent(pathname)}`);
    else if (staff && !isStaff(me)) router.replace('/painel');
  }, [isLoading, me, staff, router, pathname]);

  if (isLoading || !me || (staff && !isStaff(me))) {
    return (
      <Container className="py-10">
        <Skeleton className="h-40" />
      </Container>
    );
  }
  return <>{children(me)}</>;
}

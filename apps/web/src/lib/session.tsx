'use client';

import type { Me, Session } from '@soscomida/contracts';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiClientError, api } from './api';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (falhas, erro) => !(erro instanceof ApiClientError && erro.status < 500) && falhas < 2,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Usuário da sessão; `null` quando não há login. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<Me | null> => (await api<Session>('/auth/session')).user,
  });
}

export function useRefreshSession() {
  const client = useQueryClient();
  return () => client.invalidateQueries();
}

export const isStaff = (me: Me | null | undefined) => !!me && (me.roles.includes('moderator') || me.roles.includes('admin'));

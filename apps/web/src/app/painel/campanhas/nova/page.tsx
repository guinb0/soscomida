'use client';

import type { OwnedCampaign } from '@soscomida/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { CampaignForm, toFormDefaults } from '@/components/campaign-form';
import { RequireSession } from '@/components/require-session';
import { Card, Container, PageTitle } from '@/components/ui';
import { api } from '@/lib/api';

export default function NovaCampanhaPage() {
  const router = useRouter();
  const client = useQueryClient();
  return (
    <RequireSession>
      {() => (
        <Container className="max-w-3xl py-10">
          <PageTitle title="Nova campanha" subtitle="Ela fica em rascunho até você enviar para análise da moderação." />
          <Card className="p-6 sm:p-8">
            <CampaignForm
              initial={toFormDefaults()}
              submitLabel="Salvar rascunho"
              onSubmit={async (input) => {
                const criada = await api<OwnedCampaign>('/me/campaigns', { method: 'POST', json: input });
                await client.invalidateQueries({ queryKey: ['me', 'campaigns'] });
                router.push(`/painel/campanhas/${criada.id}`);
              }}
            />
          </Card>
        </Container>
      )}
    </RequireSession>
  );
}

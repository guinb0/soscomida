import type { Metadata } from 'next';
import { Container, PageTitle } from '@/components/ui';

export const metadata: Metadata = { title: 'O que cada número significa' };

const NUMEROS = [
  {
    nome: 'Arrecadação confirmada',
    texto:
      'Soma das doações que o provedor de pagamento (Pix) confirmou. Um Pix gerado e não pago não entra. A confirmação vem do provedor, nunca do navegador de quem doou.',
  },
  {
    nome: 'Tarifas do pagamento',
    texto: 'O que o provedor Pix cobra por transação. Mostramos separado para ninguém confundir o bruto com o que de fato fica para a causa.',
  },
  { nome: 'Estornos', texto: 'Doações devolvidas a quem doou. Saem do total disponível para a campanha.' },
  {
    nome: 'Líquido estimado',
    texto:
      'Arrecadação confirmada menos tarifas e estornos. É uma estimativa até a conciliação com o extrato do provedor. A plataforma não guarda o dinheiro — ele fica na conta do provedor de pagamento.',
  },
  {
    nome: 'Orçamento planejado',
    texto: 'Como o organizador disse que vai gastar a meta, por categoria. Aprovado pela moderação antes de a campanha receber doações.',
  },
];

const SELOS = [
  {
    nome: 'Nota autenticada no fisco',
    texto:
      'O fisco confirmou que a nota existe, foi autorizada e não foi cancelada. Só aparece quando a consulta oficial foi possível. Hoje a plataforma ainda não tem a integração oficial (exige certificado digital), então as notas aparecem como "não verificável automaticamente" e passam por revisão humana.',
  },
  { nome: 'Pagamento conferido', texto: 'A revisão conferiu que o comprovante de pagamento é compatível com a nota (valor, data e favorecido).' },
  { nome: 'Despesa aprovada', texto: 'Uma pessoa da revisão analisou os documentos e os alertas automáticos e aprovou, com justificativa registrada.' },
  { nome: 'Entrega comprovada', texto: 'A revisão aceitou a evidência de que o bem ou serviço chegou a quem precisava.' },
];

export default function TransparenciaPage() {
  return (
    <Container className="max-w-3xl py-10">
      <PageTitle title="O que cada número significa" subtitle="Preferimos mostrar vários números claros a um selo genérico de “verificado”." />

      <section className="space-y-4">
        {NUMEROS.map((n) => (
          <div key={n.nome} className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="font-display text-lg font-bold text-ink-900">{n.nome}</h2>
            <p className="mt-1 text-ink-700">{n.texto}</p>
          </div>
        ))}
      </section>

      <h2 className="mt-12 mb-4 font-display text-2xl font-extrabold text-ink-900">Selos da prestação de contas</h2>
      <p className="mb-4 text-ink-600">
        Cada despesa mostra três selos independentes e o resultado da revisão humana. Uma nota autêntica não prova sozinha que o dinheiro da
        campanha foi bem usado.
      </p>
      <section className="space-y-4">
        {SELOS.map((s) => (
          <div key={s.nome} className="rounded-2xl border border-line bg-surface p-5">
            <h3 className="font-bold text-ink-900">{s.nome}</h3>
            <p className="mt-1 text-ink-700">{s.texto}</p>
          </div>
        ))}
      </section>

      <h2 className="mt-12 mb-4 font-display text-2xl font-extrabold text-ink-900">O que nunca publicamos</h2>
      <p className="text-ink-700">
        CPF, endereço, dados bancários, dados médicos e documentos com informações pessoais. Os arquivos originais de notas e comprovantes ficam
        privados (só a organização e a equipe de revisão abrem, e cada abertura fica registrada). Na página pública aparecem os dados lidos da nota
        — emitente, número, itens e valores — sem a chave de acesso e sem o CPF de quem comprou. CPF de fornecedor pessoa física aparece mascarado.
      </p>
    </Container>
  );
}

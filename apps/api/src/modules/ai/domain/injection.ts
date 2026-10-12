/**
 * Pré-filtro determinístico contra prompt injection. Textos enviados pelo
 * organizador (descrição, fornecedor, itens da nota, justificativas) que
 * tentam dar ordens a um sistema automático viram alerta de fraude — com ou
 * sem IA configurada. Não substitui o isolamento dos dados no prompt; é um
 * sinal a mais para a revisão humana.
 */
export interface InstructionSignal {
  code: 'IGNORE_INSTRUCTIONS' | 'ORDER_TO_APPROVE' | 'ROLE_OVERRIDE' | 'PROMPT_MARKUP' | 'OUTPUT_FORGERY';
  /** Trecho do texto original (até 120 caracteres). */
  excerpt: string;
}

const PADROES: { code: InstructionSignal['code']; re: RegExp }[] = [
  { code: 'IGNORE_INSTRUCTIONS', re: /\b(ignor\w*|desconsider\w*|esquec\w*|disregard|forget)\b.{0,40}\b(instruc\w*|regras?|orientac\w*|prompt|instructions?|rules|above|anteriores?|previous)\b/ },
  {
    code: 'ORDER_TO_APPROVE',
    re: /\b(aprove|aprova[r]?|aceite|aceitar|libere|liberar|approve|accept|mark)\b.{0,30}\b(esta|essa|este|esse|a|o|this|as)\b.{0,15}\b(despesa|nota|comprovante|gasto|expense|receipt|compativel|aprovad\w*|compatible|approved)\b/,
  },
  { code: 'ORDER_TO_APPROVE', re: /\b(classifi\w*|marque|responda|retorne|classify|answer|return)\b.{0,30}\b(como|com|as|with)\b.{0,10}\b(compativel|compatible|approve|aprovad\w*|low|baixo)\b/ },
  {
    code: 'ROLE_OVERRIDE',
    re: /\b(voce agora e|a partir de agora,? voce|atue como|aja como|finja (que|ser)|you are now|act as|pretend to be|modo desenvolvedor|developer mode|jailbreak)\b/,
  },
  { code: 'PROMPT_MARKUP', re: /<\/?\s*(system|assistant|user|instructions?)\s*>|\[\/?(inst|system)\]|#{2,}\s*(system|instruc\w*)|\b(system prompt|prompt do sistema|mensagem do sistema)\b/ },
  { code: 'OUTPUT_FORGERY', re: /"\s*(classification|recommendation|risklevel|purposealignment)\s*"\s*:/ },
];

const normalizar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');

export function detectSuspiciousInstructions(textos: (string | null | undefined)[]): InstructionSignal[] {
  const sinais: InstructionSignal[] = [];
  const vistos = new Set<string>();
  for (const original of textos) {
    if (!original) continue;
    const t = normalizar(original);
    for (const { code, re } of PADROES) {
      const m = re.exec(t);
      if (!m) continue;
      const inicio = Math.max(0, m.index - 20);
      const trecho = original.replace(/\s+/g, ' ').slice(inicio, inicio + 120).trim();
      const chave = `${code}:${trecho}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      sinais.push({ code, excerpt: trecho });
    }
  }
  return sinais;
}

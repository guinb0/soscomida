import {
  ADHERENCE_LABELS,
  type AdherenceOutput,
  type AiStatus,
  EXPENSE_FLAG_LABELS,
  type ExpenseFlag,
  FISCAL_CHECK_LABELS,
  type FiscalCheck,
  type RiskLevel,
  type RiskPolicyRules,
} from '@soscomida/contracts';

/**
 * Pontuação de risco das despesas. Regras determinísticas, versionadas: a
 * política padrão está aqui (risco-v1) e a administração pode publicar novas
 * versões (risk_policies); cada análise guarda a versão com que foi feita. A
 * IA só soma pontos — nunca reduz o risco — e as regras "duras" prevalecem.
 */
export const RULESET_VERSION = 'risco-v1';

const FLAG_POINTS: Record<ExpenseFlag, number> = {
  NO_FISCAL_DOCUMENT: 15,
  AMOUNT_EXCEEDS_FISCAL: 20,
  SUPPLIER_MISMATCH: 15,
  DATE_OUTSIDE_CAMPAIGN: 15,
  OVER_BUDGET_CATEGORY: 10,
  DUPLICATE_FILE: 35,
  SHARED_FISCAL_DOCUMENT: 5,
  FISCAL_NOT_AUTHORIZED_IN_XML: 20,
  FISCAL_HOMOLOGATION: 40,
  FISCAL_WARNINGS: 15,
  FISCAL_TOTAL_DECLARED: 5,
  NO_PAYMENT_PROOF: 10,
  XML_SIGNATURE_MISSING: 15,
  XML_SIGNATURE_INVALID: 45,
  XML_SIGNATURE_CERTIFICATE: 25,
  SIMILAR_IMAGE: 25,
  SUSPICIOUS_INSTRUCTIONS: 30,
};

export const DEFAULT_RISK_RULES: RiskPolicyRules = {
  flagPoints: FLAG_POINTS,
  fiscalPoints: { CANCELLED: 60, NOT_FOUND: 45, DIVERGENT: 45 },
  aiPoints: { COMPATIBLE: 0, POSSIBLY_COMPATIBLE: 10, INSUFFICIENT_EVIDENCE: 10, REQUIRES_HUMAN_REVIEW: 10, INCOMPATIBLE: 30 },
  hardFlags: ['DUPLICATE_FILE', 'FISCAL_HOMOLOGATION', 'XML_SIGNATURE_INVALID'],
  mediumFrom: 20,
  highFrom: 50,
};

/** Situação fiscal grave é sempre risco alto (não é configurável). */
const HARD_FISCAL: FiscalCheck[] = ['CANCELLED', 'NOT_FOUND', 'DIVERGENT'];

export interface RiskFactor {
  code: string;
  label: string;
  points: number;
  source: 'RULE' | 'FISCAL' | 'AI';
}

export interface RiskResult {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
}

export function computeRisk(
  i: { flags: ExpenseFlag[]; fiscalCheck: FiscalCheck; ai: { status: AiStatus; output: AdherenceOutput | null } },
  p: RiskPolicyRules = DEFAULT_RISK_RULES,
): RiskResult {
  const fatores: RiskFactor[] = [];
  for (const f of i.flags) fatores.push({ code: f, label: EXPENSE_FLAG_LABELS[f], points: p.flagPoints[f], source: 'RULE' });
  const pontosFiscais = (p.fiscalPoints as Partial<Record<FiscalCheck, number>>)[i.fiscalCheck];
  if (pontosFiscais) fatores.push({ code: `FISCAL_${i.fiscalCheck}`, label: FISCAL_CHECK_LABELS[i.fiscalCheck], points: pontosFiscais, source: 'FISCAL' });

  const regras = fatores.reduce((t, f) => t + f.points, 0);
  const duro = i.flags.some((f) => p.hardFlags.includes(f)) || HARD_FISCAL.includes(i.fiscalCheck);
  const nivelRegras: RiskLevel = duro || regras >= p.highFrom ? 'HIGH' : regras >= p.mediumFrom ? 'MEDIUM' : 'LOW';

  const ia = i.ai.output;
  if (ia) {
    fatores.push({ code: `AI_${ia.classification}`, label: `IA: ${ADHERENCE_LABELS[ia.classification]}`, points: p.aiPoints[ia.classification], source: 'AI' });
    const injecaoPelaIa = ia.detectedIssues.some((d) => d.code === 'PROMPT_INJECTION_SUSPECT');
    if (injecaoPelaIa && !i.flags.includes('SUSPICIOUS_INSTRUCTIONS')) {
      fatores.push({ code: 'AI_PROMPT_INJECTION_SUSPECT', label: 'IA: texto parece tentar manipular a análise', points: 20, source: 'AI' });
    }
    // Divergência: a regra prevalece e o caso fica marcado.
    if (nivelRegras === 'HIGH' && ia.recommendation === 'APPROVE') {
      fatores.push({ code: 'AI_DIVERGES_FROM_RULES', label: 'IA recomendou aprovar, mas as regras apontam risco alto (as regras prevalecem)', points: 0, source: 'AI' });
    }
  } else if (i.ai.status !== 'COMPLETED') {
    fatores.push({ code: `AI_${i.ai.status}`, label: 'Sem análise de IA: decisão só com as regras e a revisão humana', points: 0, source: 'AI' });
  }

  const score = Math.min(100, fatores.reduce((t, f) => t + f.points, 0));
  const level: RiskLevel = duro || score >= p.highFrom ? 'HIGH' : score >= p.mediumFrom ? 'MEDIUM' : 'LOW';
  return { score, level, factors: fatores };
}

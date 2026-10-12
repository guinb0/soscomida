import { Inject, Injectable } from '@nestjs/common';
import { type RiskPolicy, type RiskPolicyInput, riskPolicyRulesSchema } from '@soscomida/contracts';
import { desc, sql } from 'drizzle-orm';
import { DB, type Database } from '../../infra/db/db';
import { versionConflict } from '../../infra/http/errors';
import { newId } from '../../infra/ids';
import { AuditService } from '../audit';
import type { AuthContext } from '../identity';
import { DEFAULT_RISK_RULES, RULESET_VERSION } from './domain/risk';
import { riskPolicies } from './infra/expenses.schema';

type PolicyRow = typeof riskPolicies.$inferSelect;

const PADRAO: RiskPolicy = { version: 0, label: RULESET_VERSION, rules: DEFAULT_RISK_RULES, reason: null, createdBy: null, createdAt: null };

/**
 * Política de risco vigente. A administração publica novas versões pela tela
 * (/moderacao/risco); nada é editado no lugar, e cada análise guarda o nome
 * da versão usada. Mudança não reanalisa o que já foi analisado.
 */
@Injectable()
export class RiskPolicyService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async current(): Promise<RiskPolicy> {
    const [l] = await this.db.select().from(riskPolicies).orderBy(desc(riskPolicies.version)).limit(1);
    return l ? this.toView(l) : PADRAO;
  }

  async history(): Promise<RiskPolicy[]> {
    const linhas = await this.db.select().from(riskPolicies).orderBy(desc(riskPolicies.version)).limit(50);
    return [...linhas.map((l) => this.toView(l)), PADRAO];
  }

  async publish(auth: AuthContext, input: RiskPolicyInput): Promise<RiskPolicy> {
    const regras = riskPolicyRulesSchema.parse(input.rules);
    await this.db.transaction(async (tx) => {
      // Uma publicação por vez: duas pessoas editando a mesma versão → a segunda recebe conflito.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('risk_policies'))`);
      const [atual] = await tx.select({ version: riskPolicies.version }).from(riskPolicies).orderBy(desc(riskPolicies.version)).limit(1);
      const vigente = atual?.version ?? 0;
      if (vigente !== input.basedOnVersion) throw versionConflict();
      const nova = vigente + 1;
      const id = newId();
      await tx.insert(riskPolicies).values({ id, version: nova, rules: regras, reason: input.reason, createdBy: auth.userId });
      await this.audit.record(
        { actorUserId: auth.userId, action: 'risk_policy.published', targetType: 'risk_policy', targetId: id, metadata: { version: nova, reason: input.reason } },
        tx,
      );
    });
    return this.current();
  }

  private toView(l: PolicyRow): RiskPolicy {
    return {
      version: l.version,
      label: `politica-${l.version}`,
      rules: l.rules,
      reason: l.reason,
      createdBy: l.createdBy,
      createdAt: l.createdAt.toISOString(),
    };
  }
}

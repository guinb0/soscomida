import { RuleTester } from 'eslint';
import { afterAll, describe, it } from 'vitest';
import { moduleBoundaries } from './module-boundaries.mjs';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });
const arquivo = (modulo: string, nome = 'application/servico.ts') => `/repo/apps/api/src/modules/${modulo}/${nome}`;

tester.run('module-boundaries', moduleBoundaries as never, {
  valid: [
    { code: "import { x } from '../infra/coisa';", filename: arquivo('campaigns') },
    { code: "import { LedgerService } from '../../ledger';", filename: arquivo('campaigns') },
    { code: "import { LedgerService } from '../../ledger/index';", filename: arquivo('campaigns') },
    { code: "import { users } from '../../identity/infra/identity.schema';", filename: arquivo('campaigns', 'infra/campaigns.schema.ts') },
    { code: "import { DB } from '../../../infra/db/db';", filename: arquivo('campaigns') },
  ],
  invalid: [
    { code: "import { x } from '../../ledger/domain/ledger';", filename: arquivo('campaigns'), errors: [{ messageId: 'boundary' }] },
    { code: "import { users } from '../../identity/infra/identity.schema';", filename: arquivo('campaigns'), errors: [{ messageId: 'boundary' }] },
  ],
});

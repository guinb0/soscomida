import path from 'node:path';

/**
 * Fronteira entre módulos de domínio: um arquivo em src/modules/A só pode
 * importar de src/modules/B pelo index.ts de B (a fachada). A única exceção
 * são arquivos *.schema.ts, que referenciam tabelas de outros módulos para
 * declarar chaves estrangeiras.
 */
export const moduleBoundaries = {
  meta: { type: 'problem', messages: { boundary: 'Importe "{{target}}" pela fachada do módulo (modules/{{module}}/index.ts).' } },
  create(context) {
    const filename = context.filename.split(path.sep).join('/');
    const match = /\/src\/modules\/([^/]+)\//.exec(filename);
    if (!match) return {};
    const own = match[1];
    const isSchema = filename.endsWith('.schema.ts');

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== 'string' || !source.startsWith('.')) return;
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(filename), source));
        const target = /\/src\/modules\/([^/]+)(\/.*)?$/.exec(resolved);
        if (!target || target[1] === own) return;
        const rest = target[2] ?? '';
        const isFacade = rest === '' || rest === '/index' || rest === '/index.ts';
        const isSchemaImport = isSchema && rest.endsWith('.schema');
        if (!isFacade && !isSchemaImport) {
          context.report({ node, messageId: 'boundary', data: { target: source, module: target[1] } });
        }
      },
    };
  },
};

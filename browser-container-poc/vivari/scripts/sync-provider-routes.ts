// Read the pinned SDK's bundled catalog without importing/running OpenCode.
import ts from 'typescript';
import { resolve } from 'node:path';
const root = resolve(import.meta.dir, '..');
const packages = resolve(root, 'probes/opencode/node_modules/@opencode-ai');
const sdk = await Bun.file(resolve(packages, 'sdk/package.json')).json();
const core = await Bun.file(resolve(packages, 'core/package.json')).json();
if (sdk.version !== '0.0.0-dev-19167' || core.version !== sdk.version) throw Error('Review catalog extraction for the new SDK version');
let catalog: Record<string, { api?: string }> | undefined;
for await (const file of new Bun.Glob('dist/chunks/*.js').scan(resolve(packages, 'core'))) {
  const text = await Bun.file(resolve(packages, 'core', file)).text();
  if (!text.includes('var snapshot_default =')) continue;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(source) !== 'snapshot_default' || !declaration.initializer || !ts.isStringLiteral(declaration.initializer)) continue;
      const parsed = JSON.parse(declaration.initializer.text);
      if (!parsed.opencode?.api) continue;
      if (catalog) throw Error('Ambiguous bundled provider catalog');
      catalog = parsed;
    }
  }
}
if (!catalog) throw Error('Pinned catalog layout changed; no provider routes generated');
const upstreams: Record<string, string> = {};
for (const [id, provider] of Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b))) {
  if (!provider.api || provider.api.includes('${')) continue;
  const url = new URL(provider.api);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) continue;
  upstreams[id] = url.href.replace(/\/$/, '');
}
await Bun.write(resolve(root, 'src/provider-upstreams.json'), JSON.stringify({ sdk: sdk.version, upstreams }, null, 2) + '\n');
console.log(`Synced ${Object.keys(upstreams).length} provider bases from SDK ${sdk.version} (offline)`);

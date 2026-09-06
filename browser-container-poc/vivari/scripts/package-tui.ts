// Host packaging only. Execution of these entries belongs to Vivari workers.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dir, '..');
const probe = resolve(root, 'probes/tui');
const out = resolve(root, '.runtime/tui-package');
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const pkg = JSON.parse(await readFile(resolve(probe, 'node_modules/@opentui/core/package.json'), 'utf8'));
if (pkg.version !== '0.4.5') throw Error(`Unexpected OpenTUI ${pkg.version}`);
await mkdir(out, { recursive: true });
const assets = [];
for (const target of ['node', 'bun'] as const) {
  const result = await Bun.build({
    entrypoints: [resolve(probe, 'renderer.mjs')], target, format: 'esm',
    external: ['node:*', 'bun:*', '@opentui/core-*'],
  });
  if (!result.success) throw new AggregateError(result.logs, 'TUI packaging failed');
  const entries = result.outputs.filter(x => x.kind === 'entry-point');
  if (entries.length !== 1) throw Error('Expected one JS entry');
  for (const output of result.outputs.filter(x => x.kind !== 'entry-point')) {
    if (output.kind !== 'asset') throw Error(`Unexpected ${output.kind}`);
    const bytes = new Uint8Array(await output.arrayBuffer());
    const file = `${target}-${basename(output.path)}.bin`;
    await writeFile(resolve(out, file), bytes);
    assets.push({ file, destination: `/tui-probe/${target}/${basename(output.path)}`, bytes: bytes.length, sha256: hash(bytes), target });
  }
  const lowered = ts.transpileModule(await entries[0].text(), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    transformers: { before: [context => source => {
      const visit: ts.Visitor = node => ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword
        ? ts.factory.createIdentifier('__packageMeta') : ts.visitEachChild(node, visit, context);
      return ts.visitNode(source, visit) as ts.SourceFile;
    }], after: [context => source => {
      const visit: ts.Visitor = node => ts.isCallExpression(node) && node.pos === -1 && ts.isIdentifier(node.expression) && node.expression.text === 'require'
        ? ts.factory.updateCallExpression(node, ts.factory.createIdentifier('__packageRequire'), node.typeArguments, node.arguments)
        : ts.visitEachChild(node, visit, context);
      return ts.visitNode(source, visit) as ts.SourceFile;
    }] },
  }).outputText;
  const bytes = `const __packageRequire = require;\n(async function(){\nconst __packageMeta={url:require('node:url').pathToFileURL(__filename).href,resolve:s=>require('node:url').pathToFileURL(require.resolve(s)).href};\n${lowered}\n})().catch(e=>{console.error('tui: module failed', e.stack??String(e));process.exitCode=1;});\n`;
  const file = `renderer-${target}.txt`;
  await writeFile(resolve(out, file), bytes);
  assets.push({ file, destination: `/tui-probe/${target}/renderer.cjs`, bytes: Buffer.byteLength(bytes), sha256: hash(bytes), target });
}
for (const name of ['package.json', 'LICENSE']) {
  const bytes = await readFile(resolve(probe, 'node_modules/@opentui/core', name));
  const file = `opentui-${name}.bin`;
  await writeFile(resolve(out, file), bytes);
  assets.push({ file, destination: `/tui-probe/${name}`, bytes: bytes.length, sha256: hash(bytes), target: 'metadata' });
}
const receipt = { opentui: pkg.version, opentuiGitHead: '0c8c4f7cff2927e3df63a9757a45eff9a343611c',
  cli: '0.0.0-dev-19167', sourceAudit: '5cf9f517cfec3ef68d3e68a12a6a4b3163947f44',
  note: 'CLI npm binary pin and source audit are separate pins; release-to-source identity is not asserted. Both real OpenTUI export conditions bundled; native modules remain external and unresolved.',
  bun: Bun.version, typescript: ts.version, lockSha256: hash(await readFile(resolve(probe, 'bun.lock'))), assets };
await writeFile(resolve(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(receipt);

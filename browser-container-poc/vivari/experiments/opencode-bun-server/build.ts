import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const result = await Bun.build({
  entrypoints: [resolve(import.meta.dir, 'server.ts')],
  target: 'node',
  outdir: resolve(import.meta.dir, '../../.runtime/opencode-bun-server'),
  plugins: [{
    name: 'published-jsonc-esm-entry',
    setup(build) {
      build.onResolve({ filter: /^jsonc-parser$/ }, args => {
        const main = createRequire(args.importer).resolve('jsonc-parser');
        return { path: resolve(dirname(main), '../esm/main.js') };
      });
    },
  }],
});
for (const log of result.logs) console.error(log);
if (!result.success) process.exit(1);
for (const output of result.outputs) {
  console.log(JSON.stringify({ checkpoint: 'OPENCODE_BUILD_OUTPUT', path: output.path,
    bytes: output.size, kind: output.kind }));
}
// These runtime-resolved data files are not emitted by the Node-target bundler.
const requireSource = createRequire(resolve(import.meta.dir, '../../.runtime/opencode-v2-source/packages/cli/package.json'));
for (const [pkg, file] of [
  ['web-tree-sitter', 'tree-sitter.wasm'],
  ['tree-sitter-bash', 'tree-sitter-bash.wasm'],
  ['tree-sitter-powershell', 'tree-sitter-powershell.wasm'],
]) {
  const source = requireSource.resolve(`${pkg}/${file}`);
  const path = resolve(import.meta.dir, '../../.runtime/opencode-bun-server', file);
  const bytes = await Bun.write(path, Bun.file(source));
  console.log(JSON.stringify({ checkpoint: 'OPENCODE_BUILD_ASSET_COPY', source, path, bytes }));
}

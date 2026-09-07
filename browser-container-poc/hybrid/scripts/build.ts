import { resolve } from 'node:path';
const root = resolve(import.meta.dir, '..');
const result = await Bun.build({ entrypoints: [resolve(root, 'src/main.ts'), resolve(root, '.artifacts/references/runtime.ts')],
  outdir: resolve(root, 'dist'), target: 'browser', minify: false, naming: '[name].[ext]',
  plugins: [{ name: 'reuse-frozen-qemu-terminal-dependencies', setup(build) {
    build.onResolve({ filter: /^(@xterm\/|xterm-pty)/ }, args => ({ path: Bun.resolveSync(args.path, resolve(root, '../qemu')) }));
  } }] });
if (!result.success) throw new AggregateError(result.logs);
console.log(`Built ${result.outputs.length} static harness assets (no host fixture server).`);

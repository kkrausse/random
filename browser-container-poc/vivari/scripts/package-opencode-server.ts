// Host packaging only; execute the emitted entry in a Vivari guest.
import { resolve, dirname, basename } from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'

const root = resolve(import.meta.dir, '..')
const source = resolve(process.env.OPENCODE_SOURCE || resolve(root, '.runtime/opencode-v2-source'))
const out = resolve(root, '.runtime/opencode-server-package')
const revision = 'd7a7256bb6b0952f486c95718cfbf460b1570a56'
const run = (args: string[]) => {
  const result = Bun.spawnSync(args, { cwd: source, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode) throw Error(result.stderr.toString())
  return result.stdout.toString().trim()
}
if (run(['git', 'rev-parse', 'HEAD']) !== revision) throw Error(`Requires pinned OpenCode source ${revision}`)
// A historical TUI-only patch may exist in the shared source checkout. Never apply it here.
const diff = run(['git', 'diff', '--binary', 'HEAD'])
const historicalPatch = (await Bun.file(resolve(root, 'patches/opencode-v2/0001-optional-process-metrics.patch')).text()).trim()
if (diff && diff !== historicalPatch) throw Error('Unrecognized OpenCode source changes')
const requireSource = createRequire(resolve(source, 'packages/cli/package.json'))
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const assets: { file: string; destination: string; bytes: number; sha256: string }[] = []
async function asset(file: string, destination: string, bytes: string | Uint8Array) {
  await Bun.write(resolve(out, file), bytes)
  assets.push({ file, destination, bytes: Buffer.byteLength(bytes), sha256: hash(bytes) })
}
const entry = resolve(out, 'server-entry.ts')
await Bun.write(entry, `import {run} from ${JSON.stringify(resolve(source, 'packages/cli/src/server-process.ts'))};
import {Effect} from ${JSON.stringify(requireSource.resolve('effect'))};
import {NodeRuntime} from ${JSON.stringify(requireSource.resolve('@effect/platform-node'))};
NodeRuntime.runMain(run({mode:'service',hostname:'127.0.0.1',port:Number(process.env.PORT || 4106)}));
`)
const external = ['node:*', 'bun:*', 'bun', 'node-gyp', '@lydell/node-pty', '@ff-labs/fff-node', '@ff-labs/fff-bun', 'bun-pty', '@napi-rs/canvas', '@opencode-ai/simulation/*']
const inputs = new Set<string>()
const trace = process.argv.includes('--trace')
const result = await Bun.build({
  entrypoints: [entry], target: 'node', format: 'esm',
  tsconfig: resolve(source, 'packages/cli/tsconfig.json'), external,
  plugins: [{ name: 'server-graph-audit', setup(build) {
    build.onResolve({ filter: /^jsonc-parser$/ }, args => ({ path: resolve(dirname(createRequire(args.importer).resolve('jsonc-parser')), '../esm/main.js') }))
    build.onLoad({ filter: /./ }, async args => {
      if (/@opentui|solid-js|packages\/(?:tui|ui)\//.test(args.path)) throw Error(`Unexpected UI dependency: ${args.path}`)
      inputs.add(args.path)
      if (trace && /packages\/core\/src\/(?:session\/context|model-resolver|session\/model-request|session\/runner\/llm)\.ts$/.test(args.path)) {
        const contents = await Bun.file(args.path).text()
        return { contents: contents.split('\n').map(line => /^\s*(?:const|let) .*= yield\* /.test(line) && !line.trimEnd().endsWith('(')
          ? `console.log('SERVER_TRACE', ${JSON.stringify(args.path.slice(source.length + 1))}, ${JSON.stringify(line.trim())});\n${line}` : line).join('\n'), loader: 'ts' }
      }
      return undefined
    })
  } }],
  define: { OPENCODE_VERSION: JSON.stringify('vivari-source-' + revision.slice(0, 8)), OPENCODE_CLI_NAME: JSON.stringify('lildax'), OPENCODE_CHANNEL: JSON.stringify('local'), OPENCODE_LIBC: JSON.stringify('glibc'), FFF_LIBC: JSON.stringify('gnu') },
})
if (!result.success) throw new AggregateError(result.logs, 'OpenCode server build failed')
for (const output of result.outputs) {
  if (output.kind !== 'entry-point' && output.kind !== 'asset') throw Error(`Unreviewed output ${output.kind}`)
  const file = output.kind === 'entry-point' ? 'server.mjs' : basename(output.path)
  await asset(file, '/opencode-server/' + file, new Uint8Array(await output.arrayBuffer()))
}
const catalogFile = Bun.file(resolve(process.env.OPENCODE_MODELS_SNAPSHOT || resolve(out, 'models.json')))
if (!await catalogFile.exists()) throw Error('Supply OPENCODE_MODELS_SNAPSHOT with the recorded models.json snapshot (see server-only handoff)')
const catalog = new Uint8Array(await catalogFile.arrayBuffer())
if (hash(catalog) !== '93c9a67396a5a459c4cd6c4ea3514ef86652019ed2bc1a3589dbc624c4a42ea9') throw Error('Catalog snapshot hash mismatch')
await asset('models.json', '/opencode-server/models.json', catalog)
for (const [pkg, wasm] of [['web-tree-sitter', 'tree-sitter.wasm'], ['tree-sitter-bash', 'tree-sitter-bash.wasm'], ['tree-sitter-powershell', 'tree-sitter-powershell.wasm'], ['@silvia-odwyer/photon-node', 'photon_rs_bg.wasm']]) {
  const directory = dirname(requireSource.resolve(pkg + '/package.json'))
  for (const name of [wasm!, 'package.json', ...readdirSync(directory).filter(f => /^(license|copying|notice)/i.test(f))]) {
    await asset(`dependency-${assets.length}.bin`, `/opencode-server/node_modules/${pkg}/${name}`, new Uint8Array(await Bun.file(resolve(directory, name)).arrayBuffer()))
  }
}
const rgDirectory = resolve(root, '.runtime/opencode-package')
const rg = await Bun.file(resolve(rgDirectory, 'rg-receipt.json')).json()
for (const item of rg.assets) {
  const bytes = new Uint8Array(await Bun.file(resolve(rgDirectory, item.file)).arrayBuffer())
  if (bytes.length !== item.bytes || hash(bytes) !== item.sha256) throw Error(`ripgrep integrity failure: ${item.file}`)
  await asset('search-' + item.file, item.destination, bytes)
  if (item.destination === '/bin/rg') await asset('search-cache-rg.cjs', '/workspace/.server/cache/opencode/bin/rg', bytes)
}
await Bun.write(resolve(out, 'receipt.json'), JSON.stringify({
  revision, bun: Bun.version, entry: '/opencode-server/server.mjs',
  upstreamEntry: 'packages/cli/src/server-process.ts', sourcePatches: [],
  excludedCheckoutPatch: diff ? 'TUI optional-process-metrics (outside server graph)' : null,
  transforms: ['Select published jsonc-parser ESM build: Bun leaves UMD relative requires unresolved', ...(trace ? ['Diagnostic yield checkpoints in session context/model request/resolver/runner'] : [])], external, lockSha256: hash(new Uint8Array(await Bun.file(resolve(source, 'bun.lock')).arrayBuffer())),
  inputs: [...inputs].map(p => p.replace(source + '/', '')).sort(), assets,
  search: { receiptSha256: hash(await Bun.file(resolve(rgDirectory, 'rg-receipt.json')).text()), adaptations: [...rg.packaging, 'Also provision upstream binary cache: Vivari chmod is currently a no-op, so which rejects /bin/rg'] },
  qualification: 'Unqualified: package creation is not server acceptance',
}, null, 2) + '\n')
console.log(`Packaged server-only graph: ${inputs.size} inputs, ${assets.length} assets → ${out}`)

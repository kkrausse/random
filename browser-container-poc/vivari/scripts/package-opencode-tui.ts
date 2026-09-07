// Source packaging only. Both emitted entries execute exclusively in guests.
import { resolve, basename, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { readdirSync } from 'node:fs'
const root = resolve(import.meta.dir, '..')
const v2 = process.argv.includes('--v2')
const name = v2 ? 'opencode-v2' : 'opencode-tui'
const source = resolve(process.env.OPENCODE_SOURCE || resolve(root, `.runtime/${name}-source`))
const revision = v2 ? 'd7a7256bb6b0952f486c95718cfbf460b1570a56' : '5cf9f517cfec3ef68d3e68a12a6a4b3163947f44'
const run = (args: string[]) => {
  const p = Bun.spawnSync(args, {cwd:source, stderr:'pipe', stdout:'pipe'})
  if (p.exitCode) throw Error(p.stderr.toString())
  return p.stdout.toString().trim()
}
if (run(['git','rev-parse','HEAD']) !== revision) throw Error('Requires pinned OpenCode source ' + revision)
const sourceDiff=run(['git','diff','--binary','HEAD'])
const sourcePatch=v2?await Bun.file(resolve(root,'patches/opencode-v2/0001-optional-process-metrics.patch')).text():''
if(sourceDiff!==sourcePatch.trim()) {
  if(sourceDiff || !sourcePatch)throw Error('Unrecognized OpenCode source changes')
  run(['git','apply',resolve(root,'patches/opencode-v2/0001-optional-process-metrics.patch')])
}
const requireSource = createRequire(resolve(source,'packages/cli/package.json'))
const coreDir = dirname(requireSource.resolve('@opentui/core'))
const corePackage = await Bun.file(resolve(coreDir,'package.json')).json()
if (corePackage.version !== '0.4.5') throw Error('Install the pinned frozen source lock: OpenTUI must be 0.4.5')
const { createSolidTransformPlugin } = requireSource('@opentui/solid/bun-plugin')
const solidRequire = createRequire(requireSource.resolve('@opentui/solid'))
const solidDir = resolve(dirname(solidRequire.resolve('solid-js')), '..')
const solidVersion = (await Bun.file(resolve(solidDir,'package.json')).json()).version
if (solidVersion !== '1.9.10') throw Error('Expected source-lock Solid 1.9.10')
const out = resolve(root, `.runtime/${name}-package`)
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const assets: {file:string;destination:string;bytes:number;sha256:string;mode:string}[] = []
for (const mode of v2 ? ['cli','parser'] : ['cli','app']) {
  const entry = resolve(out, `${mode}-entry.ts`)
  // Use the exact dependency instance used by the pinned CLI/TUI.
  const imports = `import {setRenderLibPath} from ${JSON.stringify(resolve(coreDir,corePackage.exports['.'].node))};
    setRenderLibPath('/ffi-probe/opentui.ffi.json');
    console.log('OPENCODE_SOURCE_ENTRY ${mode} ${revision}');\n`
  await Bun.write(entry, mode === 'parser' ? `await import(${JSON.stringify(resolve(coreDir,'parser.worker.js'))});` : imports + (mode === 'cli'
    ? `await import(${JSON.stringify(resolve(source,'packages/cli/src/index.ts'))});`
    : `const {runTui}=await import(${JSON.stringify(resolve(source,'packages/cli/src/tui.ts'))});
       const {Effect}=await import(${JSON.stringify(requireSource.resolve('effect'))});
       const services=await import(${JSON.stringify(requireSource.resolve('@effect/platform-node/NodeServices'))});
       const {Global}=await import(${JSON.stringify(resolve(source,'packages/core/src/global.ts'))});
       const {ServerAuth}=await import(${JSON.stringify(resolve(source,'packages/server/src/auth.ts'))});
       const fs=await import('node:fs');
       const password=fs.readFileSync(Global.Path.state+'/password','utf8');
       await Effect.runPromise(runTui({url:process.env.VV_TUI_SERVER || 'http://127.0.0.1:4096',headers:ServerAuth.headers({password})}).pipe(Effect.provide(services.layer)));`))
  const result = await Bun.build({entrypoints:[entry], target:'node', format:'esm',
    plugins:[createSolidTransformPlugin(), {name:'published-module-selection',setup(build){
      build.onResolve({filter:/^jsonc-parser$/},args=>({path:resolve(dirname(createRequire(args.importer).resolve('jsonc-parser')),'../esm/main.js')}))
      // The official plugin replaces server.js CONTENT with solid.js, while
      // OpenTUI also imports solid.js directly. Canonicalize the module identity
      // so both share the same reactive owner/context (same pinned version).
      build.onResolve({filter:/^solid-js(?:\/(?:store|web|universal))?$/},args=>{
        const sub=args.path.slice('solid-js'.length)
        return {path:resolve(solidDir,sub?`${sub.slice(1)}/dist/${sub.slice(1)}.js`:'dist/solid.js')}
      })
    }}], tsconfig:resolve(source,'packages/cli/tsconfig.json'),
    external:['node:*','bun:*','bun','node-gyp','@opentui/core-*','@lydell/node-pty','@ff-labs/fff-node','@ff-labs/fff-bun','bun-pty','@napi-rs/canvas','@opencode-ai/simulation/*'],
    define:{OPENCODE_VERSION:JSON.stringify('vivari-source-'+revision.slice(0,8)),OPENCODE_CLI_NAME:JSON.stringify('lildax'),OPENCODE_CHANNEL:JSON.stringify('local'),OPENCODE_LIBC:JSON.stringify('glibc'),FFF_LIBC:JSON.stringify('gnu')},
  })
  if (!result.success) throw new AggregateError(result.logs, `Actual OpenCode ${mode} build failed`)
  for (const output of result.outputs) {
    if (output.kind !== 'entry-point') {
      if (output.kind !== 'asset') throw Error('Unreviewed output '+output.kind)
      const bytes=new Uint8Array(await output.arrayBuffer()), file=`${mode}-${basename(output.path)}.bin`
      await Bun.write(resolve(out,file),bytes)
      assets.push({file,destination:`/${name}/${mode}/${basename(output.path)}`,bytes:bytes.length,sha256:hash(bytes),mode})
      continue
    }
    const lowered=ts.transpileModule(await output.text(),{
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
      transformers:{before:[context=>source=>{
        const visit:ts.Visitor=node=>ts.isMetaProperty(node)&&node.keywordToken===ts.SyntaxKind.ImportKeyword
          ? ts.factory.createIdentifier('__packageMeta'):ts.visitEachChild(node,visit,context)
        return ts.visitNode(source,visit) as ts.SourceFile
      }],after:[context=>source=>{
        const visit:ts.Visitor=node=>ts.isCallExpression(node)&&node.pos===-1&&ts.isIdentifier(node.expression)&&node.expression.text==='require'
          ? ts.factory.updateCallExpression(node,ts.factory.createIdentifier('__packageRequire'),node.typeArguments,node.arguments):ts.visitEachChild(node,visit,context)
        return ts.visitNode(source,visit) as ts.SourceFile
      }]},
    }).outputText
    const bytes=`const __packageRequire=require;\n(async function(){const __packageMeta={url:require('node:url').pathToFileURL(__filename).href,resolve:s=>require('node:url').pathToFileURL(require.resolve(s)).href};\n${lowered}\n})().catch(e=>{console.error('OPENCODE_SOURCE_FAILED',e.stack||String(e));process.exitCode=1;});\n`
    const file=`${mode}.cjs`
    await Bun.write(resolve(out,file),bytes)
    assets.push({file,destination:`/${name}/${mode}/entry.cjs`,bytes:Buffer.byteLength(bytes),sha256:hash(bytes),mode})
  }
}
if (v2) {
  const catalogPath=resolve(out,'models.json')
  const catalogHash='93c9a67396a5a459c4cd6c4ea3514ef86652019ed2bc1a3589dbc624c4a42ea9'
  if(!await Bun.file(catalogPath).exists()) {
    const response=await fetch('https://models.opencode.ai/api.json')
    if(!response.ok)throw Error(`Catalog download failed: ${response.status}`)
    const bytes=new Uint8Array(await response.arrayBuffer())
    if(hash(bytes)!==catalogHash)throw Error('Public catalog changed; supply the recorded models.json snapshot or explicitly review a new pin')
    await Bun.write(catalogPath,bytes)
  }
  const catalog=new Uint8Array(await Bun.file(catalogPath).arrayBuffer())
  if(hash(catalog)!==catalogHash)throw Error('Catalog snapshot hash mismatch')
  assets.push({file:'models.json',destination:`/${name}/models.json`,bytes:catalog.length,sha256:catalogHash,mode:'cli'})
  for(const item of ['bip-bop-01.mp3','bip-bop-03.mp3','staplebops-06.mp3','nope-03.mp3','yup-01.mp3']) {
    const bytes=new Uint8Array(await Bun.file(resolve(source,'packages/ui/src/assets/audio',item)).arrayBuffer()),file=`audio-${item}`
    await Bun.write(resolve(out,file),bytes)
    assets.push({file,destination:`/${name}/node_modules/@opencode-ai/ui/audio/${item}`,bytes:bytes.length,sha256:hash(bytes),mode:'cli'})
  }
  for (const [pkg, wasm] of [['web-tree-sitter','tree-sitter.wasm'],['tree-sitter-bash','tree-sitter-bash.wasm'],['tree-sitter-powershell','tree-sitter-powershell.wasm'],['@silvia-odwyer/photon-node','photon_rs_bg.wasm']]) {
    const directory=dirname(requireSource.resolve(pkg!+'/package.json'))
    for(const item of [wasm!,'package.json',...readdirSync(directory).filter(f=>/^(license|copying|notice)/i.test(f))]) {
      const bytes=new Uint8Array(await Bun.file(resolve(directory,item)).arrayBuffer()),file=`dependency-${assets.length}.bin`
      await Bun.write(resolve(out,file),bytes)
      assets.push({file,destination:`/${name}/node_modules/${pkg}/${item}`,bytes:bytes.length,sha256:hash(bytes),mode:'cli'})
    }
  }
}
const receipt={revision,sourcePatchSha256:sourcePatch?hash(sourcePatch):null,bun:Bun.version,solidVersion,lockSha256:hash(new Uint8Array(await Bun.file(resolve(source,'bun.lock')).arrayBuffer())),assets,
  note:v2?'Matched V2 CLI/server source; reviewed optional-process-metrics source patch, official Solid compiler, pinned public model catalog. Guest-only execution.':'Unmodified pinned source and official Solid compiler plugin; CLI and direct actual runTui entry. App entry needs a guest service for connected behavior; no mock transport or model.'}
await Bun.write(resolve(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n')
console.log(receipt)

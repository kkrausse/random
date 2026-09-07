// Measure declarations with Zig; deliver the actual TS field schemas for the
// real packer to check INSIDE the guest. Host pointer-size measurements are not
// evidence of a guest ABI (bun-ffi-structs selects size using process.arch).
import { resolve } from 'node:path'
import ts from 'typescript'
const root = resolve(import.meta.dir, '..')
const src = resolve(root, '.runtime/opentui-source/packages/core/src')
const text = await Bun.file(resolve(src, 'zig-structs.ts')).text()
const ast = ts.createSourceFile('zig-structs.ts', text, ts.ScriptTarget.Latest, true)
const schemas: Record<string, [string, string | string[], {lengthOf?: string}?][]> = {}
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === 'defineStruct') {
    const list = node.initializer.arguments[0]!
    if (!ts.isArrayLiteralExpression(list)) throw Error('Struct declaration drift')
    schemas[node.name.getText(ast)] = list.elements.map(element => {
      if (!ts.isArrayLiteralExpression(element) || !ts.isStringLiteral(element.elements[0]!)) throw Error('Field declaration drift')
      const name = element.elements[0].text, type = element.elements[1]!
      const options = element.elements[2]
      const lengthOf = options && ts.isObjectLiteralExpression(options) ? options.properties.find(p=>ts.isPropertyAssignment(p) && p.name.getText(ast) === 'lengthOf') : undefined
      const option = lengthOf && ts.isPropertyAssignment(lengthOf) && ts.isStringLiteral(lengthOf.initializer) ? {lengthOf:lengthOf.initializer.text} : {}
      if (ts.isStringLiteral(type)) return [name, type.text, option]
      if (ts.isArrayLiteralExpression(type) && ts.isStringLiteral(type.elements[0]!)) return [name, [type.elements[0].text]]
      if (['UnicodeMethodEnum', 'TerminalMultiplexerEnum', 'Osc52SupportEnum', 'GrowthPolicyEnum'].includes(type.getText(ast))) return [name, 'u8']
      throw Error(`Unreviewed field ${name}: ${type.getText(ast)}`)
    })
  }
  ts.forEachChild(node, visit)
}
visit(ast)
const mapping: Record<string, [string, string, string?]> = {
  StyledChunkStruct: ['text-buffer.zig', 'StyledChunk', 'WireStyledChunk'],
  TerminalCapabilitiesStruct: ['lib.zig', 'ExternalCapabilities', 'WireExternalCapabilities'],
  CursorStyleOptionsStruct: ['lib.zig', 'CursorStyleOptions'],
  LineInfoStruct: ['lib.zig', 'ExternalLineInfo'],
  HighlightStruct: ['lib.zig', 'ExternalHighlight'], LogicalCursorStruct: ['lib.zig', 'ExternalLogicalCursor'],
  VisualCursorStruct: ['lib.zig', 'ExternalVisualCursor'], EncodedCharStruct: ['lib.zig', 'EncodedChar'],
  MeasureResultStruct: ['lib.zig', 'ExternalMeasureResult'], CursorStateStruct: ['lib.zig', 'ExternalCursorState'],
  GridDrawOptionsStruct: ['lib.zig', 'ExternalGridDrawOptions'], BuildOptionsStruct: ['lib.zig', 'ExternalBuildOptions'],
  AllocatorStatsStruct: ['lib.zig', 'ExternalAllocatorStats'], NativeRenderStatsStruct: ['lib.zig', 'ExternalRenderStats'],
  NativeSpanFeedOptionsStruct: ['native-span-feed.zig', 'Options'], NativeSpanFeedStatsStruct: ['native-span-feed.zig', 'Stats'],
  SpanInfoStruct: ['native-span-feed.zig', 'SpanInfo'], ReserveInfoStruct: ['native-span-feed.zig', 'ReserveInfo'],
  AudioCreateOptionsStruct: ['audio.zig', 'CreateOptions'], AudioStartOptionsStruct: ['audio.zig', 'StartOptions'],
  AudioVoiceOptionsStruct: ['audio.zig', 'VoiceOptions'], AudioStreamCreateOptionsStruct: ['audio.zig', 'StreamOptions'],
  AudioStreamStatsStruct: ['audio.zig', 'StreamStats'], AudioStatsStruct: ['audio.zig', 'Stats'],
}
if (Object.keys(schemas).some(n => !mapping[n])) throw Error('New TS record needs ABI review')
let probe = ''
const definitions = []
for (const [name, fields] of Object.entries(schemas)) {
  const [file, nativeName, wireName] = mapping[name]!
  const read = async (file: string, type: string) => {
    const source = await Bun.file(resolve(src, 'zig', file)).text()
    const body = source.match(new RegExp(`(?:pub )?const ${type} = extern struct \\{([\\s\\S]*?)\\n\\};`))?.[1]
    if (!body) throw Error(`Missing ${type}`)
    // Keep only the actual field declarations (ignore helper methods/defaults).
    return [...body.matchAll(/^    (\w+): ([^,=\n]+)(?: = [^,\n]+)?,/gm)].map(m => ({name:m[1]!, type:m[2]!.trim()}))
  }
  const original = await read(file, nativeName), wire = wireName ? await read('wasm-lib.zig', wireName) : original
  if (original.length !== fields.length || wire.length !== fields.length) throw Error(`Field count drift ${name}`)
  for (const [suffix, decl] of [['native', original], ['wire', wire]] as const) {
    const type = `${name}_${suffix}`
    probe += `const ${type} = extern struct {\n${decl.map(f=>`    ${f.name}: ${f.type},`).join('\n')}\n};\n`
    probe += `export fn ${type}_size() u32 { return @sizeOf(${type}); }\n`
    decl.forEach((f, i)=>probe += `export fn ${type}_${i}() u32 { return @offsetOf(${type}, "${f.name}"); }\n`)
  }
  definitions.push({name, fields, nativeFields: original.map(f=>f.name), audioUnavailable: file === 'audio.zig'})
}
await Bun.write(resolve(root, '.runtime/ffi-layout.zig'), probe)
const proc = Bun.spawnSync(['zig', 'build-exe', '-target', 'wasm32-freestanding', '-O', 'ReleaseSmall', '-fno-entry', '-rdynamic', resolve(root, '.runtime/ffi-layout.zig'), '-femit-bin=' + resolve(root, '.runtime/ffi-layout.wasm')], {stderr:'inherit'})
if (proc.exitCode) throw Error('Layout compilation failed')
// This is static compiler-layout measurement only; consumer execution is workers.
const e = new WebAssembly.Instance(new WebAssembly.Module(await Bun.file(resolve(root, '.runtime/ffi-layout.wasm')).arrayBuffer())).exports as Record<string, () => number>
const records = definitions.map(d => ({...d, nativeSize:e[d.name+'_native_size']!(), wireSize:e[d.name+'_wire_size']!(),
  nativeOffsets:d.fields.map((_,i)=>e[d.name+'_native_'+i]!()), wireOffsets:d.fields.map((_,i)=>e[d.name+'_wire_'+i]!())}))
const report = {revision:'0c8c4f7cff2927e3df63a9757a45eff9a343611c', records,
  conclusion:'Guest packer must verify every wire size/offset. wasm32 selects pointer4; TS explicit u64 lengths require compiled adaptation. Host pointer8 layout is not the guest contract.'}
await Bun.write(resolve(root, '.runtime/ffi-layout-report.json'), JSON.stringify(report, null, 2)+'\n')
console.log(report)

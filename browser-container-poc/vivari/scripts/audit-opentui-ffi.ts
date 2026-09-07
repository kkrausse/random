// Extract the real pinned source declarations, then ask each actual layout engine.
import {resolve} from 'node:path'
import ts from 'typescript'
const root = resolve(import.meta.dir, '..')
const src = resolve(root, '.runtime/opentui-source/packages/core/src')
const text = await Bun.file(resolve(src, 'zig-structs.ts')).text()
const ast = ts.createSourceFile('zig-structs.ts', text, ts.ScriptTarget.Latest, true)
let fields: [string, string][] = []
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'StyledChunkStruct') {
    const call = node.initializer
    if (!call || !ts.isCallExpression(call) || !ts.isArrayLiteralExpression(call.arguments[0]!)) throw Error('StyledChunk declaration drift')
    fields = call.arguments[0].elements.map(element => {
      if (!ts.isArrayLiteralExpression(element) || !ts.isStringLiteral(element.elements[0]!) || !ts.isStringLiteral(element.elements[1]!)) throw Error('StyledChunk field drift')
      return [element.elements[0].text, element.elements[1].text]
    })
  }
  ts.forEachChild(node, visit)
}
visit(ast)
if (fields.length !== 7) throw Error('StyledChunk fields drift')
const {defineStruct} = await import('../probes/tui/node_modules/bun-ffi-structs/dist/index.js')
const packed = defineStruct(fields as any)
const zig = await Bun.file(resolve(src, 'zig/text-buffer.zig')).text()
const declaration = zig.match(/pub const StyledChunk = extern struct \{[\s\S]*?\n\};/)?.[0]
if (!declaration) throw Error('Native StyledChunk declaration drift')
const nativeFields = [...declaration.matchAll(/^    (\w+):/gm)].map(x => x[1]!)
const probe = declaration + '\nexport fn size() u32 { return @sizeOf(StyledChunk); }\n' + nativeFields.map((field, i) => `export fn offset${i}() u32 { return @offsetOf(StyledChunk, "${field}"); }`).join('\n')
await Bun.write(resolve(root, '.runtime/ffi-layout.zig'), probe)
const proc = Bun.spawnSync(['zig', 'build-exe', '-target', 'wasm32-freestanding', '-O', 'ReleaseSmall', '-fno-entry', '-rdynamic', resolve(root, '.runtime/ffi-layout.zig'), '-femit-bin=' + resolve(root, '.runtime/ffi-layout.wasm')], {stderr:'inherit'})
if (proc.exitCode) throw Error('Layout compilation failed')
const instance = new WebAssembly.Instance(new WebAssembly.Module(await Bun.file(resolve(root, '.runtime/ffi-layout.wasm')).arrayBuffer()))
const e = instance.exports as Record<string, () => number>
const report = {
  declarationSource: 'OpenTUI 0c8c4f7cff2927e3df63a9757a45eff9a343611c',
  tsSize: packed.size, wasmSize: e.size!(),
  fields: fields.map(([name], i) => ({name, nativeName: nativeFields[i], tsOffset: packed.layoutByName.get(name)!.offset, wasmOffset: e['offset' + i]!()})),
  conclusion: 'Opaque ptr signatures contain no field schema. Raw copy cannot convert native64 structs to wasm32. Use a build-time ABI shim or explicit general layout metadata; do not guess pointer fields.',
}
await Bun.write(resolve(root, '.runtime/ffi-layout-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(report)

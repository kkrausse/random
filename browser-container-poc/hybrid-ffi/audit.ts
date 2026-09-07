import { resolve } from 'node:path';
import ts from '../vivari/node_modules/typescript/lib/typescript.js';
const path = resolve(import.meta.dir, '../vivari/.runtime/opentui-v2-source/packages/core/src/zig.ts');
const text = await Bun.file(path).text();
const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
const signatures: any[] = [];
function visit(node: any) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'dlopen') {
    const definitions = node.arguments[1];
    if (!ts.isObjectLiteralExpression(definitions)) throw Error('Unreviewed symbols');
    for (const p of definitions.properties) {
      if (!ts.isPropertyAssignment(p) || !ts.isObjectLiteralExpression(p.initializer)) throw Error('Unreviewed symbol');
      const field = (name: string) => p.initializer.properties.find((x: any)=>x.name.getText(ast)===name)?.initializer;
      const args = field('args'), returns = field('returns');
      signatures.push({name:p.name.getText(ast),line:ast.getLineAndCharacterOfPosition(p.getStart(ast)).line+1,
        args:args.elements.map((e: any)=>e.text),returns:returns.text});
    }
  }
  ts.forEachChild(node,visit);
}
visit(ast);
const report = {source:'opentui-v2-source/packages/core/src/zig.ts',sha256:new Bun.CryptoHasher('sha256').update(text).digest('hex'),
  total:signatures.length, pointerArgs:signatures.filter(s=>s.args.includes('ptr')).length,
  bufferArgs:signatures.filter(s=>s.args.includes('buffer')).length,
  pointerReturns:signatures.filter(s=>s.returns==='ptr').length,signatures};
await Bun.write(resolve(import.meta.dir,'source-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log({...report,signatures:undefined});
const hybrid = resolve(import.meta.dir,'../hybrid');
const lock = await Bun.file(resolve(hybrid,'artifacts.lock.json')).json();
const runtime = await Bun.file(resolve(hybrid,'runtime-build.json')).json();
const inputs = [];
for (const e of [...lock.entries.filter((e: any)=>e.target.startsWith('qemu/')).map((e: any)=>({path:e.source,sha256:e.sha256})),
  ...runtime.files.map((e: any)=>({path:'.artifacts/fixed-runtime/'+e.name,sha256:e.sha256}))]) {
  const sha256 = new Bun.CryptoHasher('sha256').update(await Bun.file(resolve(hybrid,e.path)).arrayBuffer()).digest('hex');
  if (sha256 !== e.sha256) throw Error('Input drift: '+e.path);
  inputs.push({...e,verified:true});
}
await Bun.write(resolve(import.meta.dir,'provenance.json'),JSON.stringify({vivariRevision:lock.vivariRevision,
  opentuiRevision:'f6673a04ccb671b9207da358c57152bfd27c781f',inputs},null,2)+'\n');

// Packaging only: the official SDK executes exclusively in Vivari.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";
const root = resolve(import.meta.dir, "..");
const probe = resolve(root, "probes/opencode");
const entry = process.argv[2] ?? "host";
if (!["host", "tools", "sqlite-adapter"].includes(entry)) throw Error(`Unknown entry ${entry}`);
const out = resolve(root, ".runtime/opencode-package");
const external = ["node:*", "@lydell/node-pty", "@ff-labs/fff-node", "@ff-labs/fff-bun", "bun-pty"];
const sdk = JSON.parse(await readFile(resolve(probe, "node_modules/@opencode-ai/sdk/package.json"), "utf8"));
if (sdk.version !== "0.0.0-dev-19167") throw Error(`Unexpected SDK ${sdk.version}`);
const result = await Bun.build({
  entrypoints: [resolve(probe, `${entry}.mjs`)], target: "node", format: "esm", external,
  plugins: [{ name: "jsonc-parser-esm", setup(build) {
    // Its UMD factory aliases require(), leaving relative impl imports outside
    // Bun's bundle. Use the same pinned package's published ESM distribution.
    build.onResolve({ filter: /^jsonc-parser$/ }, () => ({ path: resolve(probe, "node_modules/jsonc-parser/lib/esm/main.js") }));
  } }],
});
if (!result.success) throw new AggregateError(result.logs, "SDK packaging failed");
await mkdir(out, { recursive: true });
// Lower the single bundled module with a real parser. An async wrapper keeps
// its top-level await valid; this avoids Vivari's non-entry TLA limitation.
const lowered = ts.transpileModule(await result.outputs[0].text(), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  transformers: { before: [context => source => {
    const visit: ts.Visitor = node => ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword
      ? ts.factory.createIdentifier("__packageMeta") : ts.visitEachChild(node, visit, context);
    return ts.visitNode(source, visit) as ts.SourceFile;
  }], after: [context => source => {
    // Emscripten declares a local `var require` after await import('module').
    // TS's synthesized require('module') would read that hoisted undefined local.
    // Keep source require calls intact; only generated imports use the outer loader.
    const visit: ts.Visitor = node => ts.isCallExpression(node) && node.pos === -1 &&
      ts.isIdentifier(node.expression) && node.expression.text === 'require'
      ? ts.factory.updateCallExpression(node, ts.factory.createIdentifier('__packageRequire'), node.typeArguments, node.arguments)
      : ts.visitEachChild(node, visit, context);
    return ts.visitNode(source, visit) as ts.SourceFile;
  }] },
}).outputText;
const bytes = new TextEncoder().encode(`const __packageRequire = require;\n(async function() {\nconst __packageMeta = { url: require('node:url').pathToFileURL(__filename).href, resolve: s => require('node:url').pathToFileURL(require.resolve(s)).href };\n${lowered}\n})().catch(e => { console.error(e.stack ?? String(e)); process.exitCode = 1; });\n`);
await writeFile(resolve(out, `${entry}.txt`), bytes);
const assets: { file: string; destination: string; bytes: number; sha256: string }[] = [];
if (entry === "host" || entry === "tools") {
  for (const [name, wasm] of [
    ["web-tree-sitter", "tree-sitter.wasm"],
    ["tree-sitter-bash", "tree-sitter-bash.wasm"],
    ["tree-sitter-powershell", "tree-sitter-powershell.wasm"],
    ["@silvia-odwyer/photon-node", "photon_rs_bg.wasm"],
  ]) {
    const dir = resolve(probe, "node_modules", name);
    const files = [wasm, "package.json", ...(await readdir(dir)).filter(f => /^(license|copying|notice)/i.test(f))];
    for (const source of files) {
      const data = await readFile(resolve(dir, source));
      const file = `${entry}-asset-${assets.length}.bin`;
      await writeFile(resolve(out, file), data);
      assets.push({ file, destination: `/opencode-packaged/node_modules/${name}/${source}`, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") });
    }
  }
}
if (entry === 'tools') {
  const rg = JSON.parse(await readFile(resolve(out, 'rg-receipt.json'), 'utf8'));
  assets.push(...rg.assets);
}
const receipt = {
  sdk: sdk.version, bun: Bun.version, typescript: ts.version, target: "node", external, entry,
  successMarker: entry === "tools" ? "checkpoint: tools passed" : entry === "host" ? "checkpoint: host passed" : "checkpoint: adapters passed",
  packaging: ["jsonc-parser: published lib/esm/main.js", "TypeScript CommonJS lowering with async module wrapper and bundle-relative import.meta", "Synthesized import requires use outer __packageRequire to avoid Emscripten local require shadowing"],
  bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
  lockSha256: createHash("sha256").update(await readFile(resolve(probe, "bun.lock"))).digest("hex"),
  assets,
  note: "Unchanged official entrypoint, Node conditions matching current Vivari. Native externals remain unresolved, not substituted. Pinned tree-sitter and photon WASM assets include package metadata and license files.",
};
await writeFile(resolve(out, `${entry}-receipt.json`), JSON.stringify(receipt, null, 2) + "\n");
console.log(receipt);

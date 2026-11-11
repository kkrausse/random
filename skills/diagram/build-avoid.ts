// builds avoid.js: libavoid-js as a classic script (file:// friendly), the wasm inlined as a data: URL
const d = import.meta.dir;
let js = await Bun.file(`${d}/node_modules/libavoid-js/dist/index.js`).text();
js = js.replace(/\/\/# sourceMappingURL=.*$/m, "").replace(/import\.meta\.url/g, '""');
if (!/export\{(\w+) as AvoidLib\};\s*$/.test(js)) throw new Error("export not found");
js = js.replace(/export\{(\w+) as AvoidLib\};\s*$/, "root.AvoidLib=$1;");
const wasm = Buffer.from(await Bun.file(`${d}/node_modules/libavoid-js/dist/libavoid.wasm`).arrayBuffer()).toString("base64");
await Bun.write(`${d}/avoid.js`, `// libavoid-js 0.5.0-beta.5 (LGPL-2.1-or-later, github.com/Aksem/libavoid-js) as a classic script; wasm inlined.\n` +
  `// Built by: bun build-avoid.ts. Use: await AvoidLib.load(AVOID_WASM); const A = AvoidLib.getInstance();\n` +
  `(function(root){${js}\nroot.AVOID_WASM="data:application/wasm;base64,${wasm}";})(globalThis);\n`);
console.log("avoid.js", (await Bun.file(`${d}/avoid.js`).size / 1024).toFixed(0), "KB");

// Run with browser-control execute --session SESSION --file .../capture-deps.js.
const root = state.hybridRoot || ['browser-container-poc/hybrid', 'hybrid', '.'].map(p => path.resolve(p)).find(p => fs.existsSync(p + '/scripts/pack-deps.cjs'));
if (!root) throw Error('Run from repository root/hybrid or set state.hybridRoot to the absolute hybrid directory');
const source = fs.readFileSync(root + '/scripts/pack-deps.cjs', 'utf8');
await page.evaluate(async source => {
  await hybrid.vm.fs.writeFile('/tmp/hybrid-pack-deps.cjs', source);
  await hybrid.run(['node', '/tmp/hybrid-pack-deps.cjs']);
}, source);
const manifest = await page.evaluate(async () => JSON.parse(await hybrid.vm.fs.readFile('/tmp/hybrid-deps-manifest.json', 'utf-8')));
fs.mkdirSync(root + '/.artifacts/deps', { recursive: true });
const destination = root + '/.artifacts/deps/hybrid-deps.bin';
fs.writeFileSync(destination, Buffer.alloc(0));
for (const part of manifest.parts) {
  const bytes = await page.evaluate(async path => Array.from(await hybrid.vm.fs.readFile(path)), part);
  fs.appendFileSync(destination, Buffer.from(bytes));
}
delete manifest.parts;
manifest.runtimeBuild = JSON.parse(fs.readFileSync(root + '/runtime-build.json', 'utf8'));
fs.writeFileSync(root + '/deps-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
const lock = await page.evaluate(() => hybrid.vm.fs.readFile('/workspace/package-lock.json', 'utf-8'));
fs.writeFileSync(root + '/worker-package-lock.json', lock);
return { fileCount: manifest.fileCount, logicalBytes: manifest.logicalBytes, compressedBytes: manifest.compressedBytes, sha256: manifest.sha256 };

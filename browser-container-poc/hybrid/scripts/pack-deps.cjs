// Executed only inside the browser worker, after successful Vite optimization.
const fs = require('fs'), zlib = require('zlib'), crypto = require('crypto');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const files = {};
let logicalBytes = 0;
function walk(path) {
  for (const name of fs.readdirSync('/workspace/' + path)) {
    if (name === '.bin') continue; // accelerator uses the explicit Vite JS entry
    const rel = path + '/' + name, full = '/workspace/' + rel, stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw Error('Unexpected dependency symlink: ' + rel);
    if (stat.isDirectory()) walk(rel);
    else {
      const bytes = fs.readFileSync(full); logicalBytes += bytes.length;
      files[rel] = bytes.toString('base64');
    }
  }
}
if (!fs.existsSync('/workspace/node_modules/.vite/deps/_metadata.json')) throw Error('Finish browser Vite optimization before packing');
walk('node_modules');
const lock = fs.readFileSync('/workspace/package-lock.json');
files['package-lock.json'] = lock.toString('base64');
const bytes = zlib.gzipSync(Buffer.from(JSON.stringify(files)));
const chunk = 256 * 1024, parts = [];
for (let offset = 0; offset < bytes.length; offset += chunk) {
  const path = '/tmp/hybrid-deps-part-' + parts.length;
  fs.writeFileSync(path, bytes.subarray(offset, offset + chunk)); parts.push(path);
}
const manifest = { format: 'hybrid-vivari-deps-v1', workspace: '/workspace', generatedIn: 'browser-vivari-worker',
  fileCount: Object.keys(files).length, logicalBytes, compressedBytes: bytes.length, sha256: hash(bytes),
  packageLockSha256: hash(lock), fixturePackageSha256: hash(fs.readFileSync('/workspace/package.json')),
  vite: require('/workspace/node_modules/vite/package.json').version,
  esbuild: require('/workspace/node_modules/esbuild/package.json'), parts };
fs.writeFileSync('/tmp/hybrid-deps-manifest.json', JSON.stringify(manifest));
console.log('HYBRID_DEPS_PACKED', manifest.fileCount, bytes.length, manifest.sha256);

// Executed in a Vivari process worker after delivering the real rg WASM package.
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const dir = `/workspace/rg-contract-${Date.now()}`;
fs.mkdirSync(`${dir}/.git`, { recursive: true });
fs.writeFileSync(`${dir}/.gitignore`, 'ignored.txt\n');
fs.writeFileSync(`${dir}/alpha.txt`, 'one\nneedle café\nNEEDLE\n');
fs.writeFileSync(`${dir}/ignored.txt`, 'needle\n');
fs.writeFileSync(`${dir}/.hidden`, 'needle\n');
async function run(args) {
  const child = spawn('/bin/rg', args, { cwd: dir });
  let out = '', err = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { err += d; });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  return { code, out, err };
}
(async () => {
  const version = await run(['--version']);
  assert.equal(version.code, 0); assert.match(version.out, /ripgrep 15\./);
  console.log(version.out.trim());
  const files = await run(['--no-config', '--files', '.']);
  assert.equal(files.code, 0);
  assert.match(files.out, /alpha.txt/);
  assert.doesNotMatch(files.out, /ignored|hidden/);
  const match = await run(['--json', '--ignore-case', '--', 'needle', '.']);
  assert.equal(match.code, 0);
  const rows = match.out.trim().split('\n').map(JSON.parse).filter(r => r.type === 'match');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].data.line_number, 2);
  assert.equal(rows[0].data.lines.text, 'needle café\n');
  assert.equal(rows[0].data.submatches[0].start, 0);
  assert.equal(rows[0].data.submatches[0].end, 6);
  assert.equal((await run(['--', 'absent-pattern', '.'])).code, 1);
  const invalid = await run(['--', '[', '.']);
  assert.equal(invalid.code, 2); assert.match(invalid.err, /regex parse error/);
  const hidden = await run(['--files', '--hidden', '--glob=!**/.git/**', '.']);
  assert.match(hidden.out, /\.hidden/); assert.doesNotMatch(hidden.out, /ignored.txt/);
  console.log('checkpoint: ripgrep contract passed');
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => fs.rmSync(dir, { recursive: true, force: true }));

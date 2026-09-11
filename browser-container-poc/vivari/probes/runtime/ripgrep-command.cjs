const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');
const which = require('which');

(async () => {
  const directory = process.cwd();
  const bin = path.join(directory, 'node_modules/.bin');
  const command = path.join(bin, 'rg');
  const target = path.join(directory, 'node_modules/ripgrep/lib/rg.mjs');
  fs.mkdirSync(bin, { recursive: true });
  fs.symlinkSync('../ripgrep/lib/rg.mjs', command);
  fs.chmodSync(target, 0o644);
  assert.equal(which.sync('rg', { path: bin, nothrow: true }), null, 'non-executable command must not be discovered');
  fs.chmodSync(target, 0o755);
  assert.equal(fs.statSync(command).mode & 0o777, 0o755, 'chmod must change the symlink target inode');
  assert.equal(require('isexe').sync(command), true, 'published isexe must recognize the installed command');
  assert.equal(which.sync('rg', { path: bin }), command);
  console.log('RIPGREP_COMMAND_DISCOVERED');
  const fixture = path.join(directory, 'fixture space.txt');
  fs.writeFileSync(fixture, 'COMMAND_NEEDLE\n');
  const cacheFiles = () => fs.readdirSync(tmpdir()).filter(name => /^ripgrep-wasm-.*\.wasm$/.test(name));
  for (const name of cacheFiles()) fs.rmSync(path.join(tmpdir(), name));
  async function run(args) {
    return await new Promise((resolve, reject) => {
      const child = spawn('rg', args, {
        cwd: directory,
        env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, RIPGREP_NODE_WASI: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => stdout += chunk);
      child.stderr.on('data', chunk => stderr += chunk);
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
  }
  const match = await run(['--no-config', '--no-heading', '--color=never', 'COMMAND_NEEDLE', fixture]);
  assert.deepEqual(match, { code: 0, signal: null, stdout: 'COMMAND_NEEDLE\n', stderr: '' });
  assert.ok(cacheFiles().length > 0, 'cold CLI writes published WASM cache');
  const missing = await run(['--no-config', 'ABSENT_NEEDLE', fixture]);
  assert.deepEqual(missing, { code: 1, signal: null, stdout: '', stderr: '' });
  const glob = await run(['--no-config', '--files', '--glob=fixture space.txt', '.']);
  assert.equal(glob.code, 0);
  assert.equal(glob.stdout.replace(/^\.\//, ''), 'fixture space.txt\n');
  assert.equal(glob.stderr, '');
  const invalid = await run(['--no-config', '[', fixture]);
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /regex parse error/);
  console.log('RIPGREP_COMMAND_PASS');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

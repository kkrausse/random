// Guest-only installation. Keep an existing user's executable intact.
const fs = require('fs');
const target = '/bin/opencode2';
const v2 = process.argv.includes('--v2') || process.env.VIVARI_OPENCODE_PROFILE === 'v2';
const entry = v2 ? '/opencode-v2/run.cjs' : '/opencode-tui/cli/entry.cjs';
const previous = `#!/usr/bin/env node
// vivari-source-opencode-launcher-v1
const child = require('child_process').spawn('${v2 ? 'node' : 'bun'}', ['${entry}', ...process.argv.slice(2)], {stdio:'inherit'});
process.on('SIGINT', () => child.kill('SIGINT'));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
`;
// Explicit piping also works on older live workers whose inherit mode forwarded
// only stdout/stderr. The source entry and guest Bun identity stay unchanged.
const launcher = previous.replace("{stdio:'inherit'}", "{stdio:['pipe','inherit','inherit']}")
  + "process.stdin.on('data', chunk => child.stdin.write(chunk));\nprocess.stdin.once('end', () => child.stdin.end());\nchild.on('exit', () => process.stdin.pause());\n";
if (!fs.existsSync(entry)) throw Error('Deliver the pinned OpenCode CLI first');
if (fs.existsSync(target) && ![previous, launcher].includes(fs.readFileSync(target, 'utf8'))) {
  throw Error('Refusing to replace an existing /bin/opencode2');
}
fs.writeFileSync(target, launcher);
fs.chmodSync(target, 0o755);
console.log('OPENCODE_LAUNCHER_READY: opencode2 (pinned source CLI; guest Bun worker)');

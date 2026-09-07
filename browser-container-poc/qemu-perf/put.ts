// Copy an explicitly named local spike file into /tmp of this browser guest.
import { basename } from 'node:path';
const [session, file] = process.argv.slice(2);
if (!session || !file) throw new Error('Usage: bun qemu-perf/put.ts <session> <local-file>');
const name = basename(file);
if (!/^[\w.-]+$/.test(name)) throw new Error('Unsupported filename');
const encoded = Buffer.from(await Bun.file(file).arrayBuffer()).toString('base64');
const command = `printf '%s' '${encoded}' | base64 -d > /tmp/qemu-perf-${name}; sha256sum /tmp/qemu-perf-${name}`;
const child = Bun.spawn([process.execPath, new URL('./exec.ts', import.meta.url).pathname, session, command], {
  stdout: 'inherit', stderr: 'inherit',
});
process.exit(await child.exited);

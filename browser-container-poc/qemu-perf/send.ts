// Transport only: the command executes inside the browser's Linux guest.
const [session, command] = process.argv.slice(2);
if (!session || !command) throw new Error('Usage: bun qemu-perf/send.ts <session> <guest-command>');
const code = `await page.frames()[1].evaluate((command)=>Module.pty.ldisc.writeFromLower(command),${JSON.stringify(command + '\r')}); return {sentAt:Date.now()}`;
const child = Bun.spawn(['browser-control', 'execute', '--session', session, code], { stdout: 'inherit', stderr: 'inherit' });
process.exit(await child.exited);

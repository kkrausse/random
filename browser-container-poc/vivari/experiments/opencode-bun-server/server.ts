import { Effect } from 'effect';
import { ServerProcess } from '@opencode/cli/server-process';

await Effect.runPromise(ServerProcess.run({
  mode: process.argv.includes('--service') ? 'service' : 'default', hostname: '127.0.0.1', port: 4096,
}));

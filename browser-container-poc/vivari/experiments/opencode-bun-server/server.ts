import { Effect } from 'effect';
import { ServerProcess } from '@opencode-ai/cli/server-process';

await Effect.runPromise(ServerProcess.run({
  mode: 'default', hostname: '127.0.0.1', port: 4096,
}));

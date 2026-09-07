// Run the pinned upstream suite with the same source overlay, without editing it.
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { patchWait } from './syscall-wait.ts';
const targets = ['packages/runtime/fs-client.js', 'packages/kernel-host/kernel-fs.js'];
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url.startsWith('file:') && targets.some(p => fileURLToPath(url).endsWith('/' + p))) {
    return { ...result, source: patchWait(typeof result.source === 'string' ? result.source : new TextDecoder().decode(result.source)) };
  }
  return result;
} });

// UI transport is guest stdout NDJSON; SDK, tools and session ownership stay here.
import { OpenCode } from '@opencode-ai/sdk';
import { Plugin } from '@opencode-ai/plugin';
import { Global } from '@opencode-ai/util/global';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const input = JSON.parse(fs.readFileSync('/opencode-packaged/prompt-input.json', 'utf8'));
assert(typeof input.text === 'string' && input.text.trim(), 'Prompt required');
assert(typeof input.directory === 'string' && input.directory.startsWith('/'), 'Absolute guest directory required');
assert(fs.statSync(input.directory).isDirectory(), 'Guest directory must exist');
const emit = event => console.log('sdk-event ' + JSON.stringify(event));
const model = { providerID: 'opencode', id: process.env.OPENCODE_PROBE_MODEL || 'nemotron-3.5-lightning-free' };
fs.mkdirSync(Global.Path.bin, { recursive: true });
fs.copyFileSync('/bin/rg', `${Global.Path.bin}/rg`);
const plugin = Plugin.define({
  id: 'vivari-prompt-ui',
  async setup(ctx) {
    await ctx.catalog.transform(editor => editor.provider.update('opencode', provider => {
      provider.settings = { ...provider.settings, baseURL: process.env.OPENCODE_PROBE_BASE_URL };
    }));
    await ctx.agent.transform(editor => editor.update('build', agent => {
      agent.permissions = [
        { action: '*', resource: '*', effect: 'deny' },
        ...['read', 'edit', 'shell', 'glob', 'grep'].map(action => ({ action, resource: '*', effect: 'allow' })),
      ];
    }));
    await ctx.session.hook('context', event => { event.generation.maxTokens = 4096; });
    await ctx.session.hook('retry', event => { event.decision = { retry: false }; });
  },
});
const host = await OpenCode.create({
  plugins: [plugin], models: { fetch: false },
  config: { project: false, content: JSON.stringify({ snapshots: false }) },
});
const abort = new AbortController();
const timer = setTimeout(() => abort.abort(), 180000);
let sessionID, stream, pump, streamError;
try {
  const location = { directory: input.directory };
  await host.plugin.awaitActivation({ location });
  const selected = (await host.model.list({ location })).data.find(item => item.providerID === model.providerID && item.id === model.id);
  assert(selected && selected.cost.every(tier => tier.input === 0 && tier.output === 0), 'Select a catalog-listed free Zen model');
  stream = host.events.subscribe({ signal: abort.signal })[Symbol.asyncIterator]();
  assert.equal((await stream.next()).value?.type, 'server.connected');
  const session = await host.sessions.create({ location, model, agent: 'build', title: 'Vivari prompt' });
  sessionID = session.id;
  emit({ type: 'ui.session', data: { sessionID, directory: input.directory, model } });
  let finish;
  const terminal = new Promise((resolve, reject) => {
    finish = resolve;
    abort.signal.addEventListener('abort', () => reject(Error('Prompt timed out or aborted')), { once: true });
  });
  terminal.catch(() => {});
  pump = (async () => {
    for (;;) {
      const next = await stream.next();
      if (next.done) break;
      const event = next.value;
      if (event.data?.sessionID !== sessionID) continue;
      emit(event);
      if (['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted'].includes(event.type)) finish(event);
    }
  })().catch(error => { if (!abort.signal.aborted) { streamError = error; abort.abort(); } });
  await host.sessions.prompt({ sessionID, text: input.text }, { signal: abort.signal });
  await host.sessions.wait({ sessionID }, { signal: abort.signal });
  const finished = await terminal;
  if (streamError) throw streamError;
  assert.equal(finished.type, 'session.execution.succeeded', 'Prompt did not succeed');
} catch (error) {
  emit({ type: 'ui.error', data: { sessionID, message: String(error) } });
  throw error;
} finally {
  clearTimeout(timer);
  if (sessionID) await host.sessions.interrupt({ sessionID, continue: false }).catch(() => {});
  abort.abort();
  await pump;
  await stream?.return?.();
  await host.close();
  emit({ type: 'ui.closed', data: { sessionID } });
}
console.log('checkpoint: prompt passed');

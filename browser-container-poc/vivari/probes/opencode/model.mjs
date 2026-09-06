// A real model drives the official SDK tools entirely inside Vivari workers.
import { OpenCode } from '@opencode-ai/sdk';
import { Plugin } from '@opencode-ai/plugin';
import { Global } from '@opencode-ai/util/global';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const model = { providerID: 'opencode', id: process.env.OPENCODE_PROBE_MODEL || 'big-pickle' };
const directory = `/workspace/opencode-model-${Date.now()}`;
fs.mkdirSync(directory, { recursive: true });
fs.mkdirSync(Global.Path.bin, { recursive: true });
fs.copyFileSync('/bin/rg', `${Global.Path.bin}/rg`);
const original = 'module.exports = (a, b) => a - b;\n';
const test = "require('node:assert/strict').equal(require('./sum.cjs')(2,3),5);console.log('fixture test passed');\n";
fs.writeFileSync(`${directory}/sum.cjs`, original);
fs.writeFileSync(`${directory}/sum.test.cjs`, test);
const calls = [];
const requests = [];
const eventCounts = {};
let sessionID;
const journal = (kind, data) => {
  const line = JSON.stringify({ kind, data });
  fs.appendFileSync(`${directory}/trace.ndjson`, line + '\n');
  console.log(`model-${kind}`, line);
};
const plugin = Plugin.define({
  id: 'vivari-model-qualification',
  async setup(ctx) {
    if (process.env.OPENCODE_PROBE_BASE_URL) {
      await ctx.catalog.transform(editor => editor.provider.update('opencode', provider => {
        provider.settings = { ...provider.settings, baseURL: process.env.OPENCODE_PROBE_BASE_URL };
      }));
    }
    await ctx.agent.transform(editor => editor.update('build', agent => {
      agent.permissions = [
        { action: '*', resource: '*', effect: 'deny' },
        { action: 'read', resource: '*.cjs', effect: 'allow' },
        { action: 'edit', resource: 'sum.cjs', effect: 'allow' },
        { action: 'shell', resource: 'node sum.test.cjs', effect: 'allow' },
        { action: 'glob', resource: '*', effect: 'allow' },
        { action: 'grep', resource: '*', effect: 'allow' },
      ];
    }));
    await ctx.session.hook('context', event => { event.generation.maxTokens = 4096; });
    await ctx.session.hook('retry', event => { event.decision = { retry: false }; });
    await ctx.session.hook('http.request', event => {
      const url = new URL(event.request.url);
      const request = { kind: event.kind, origin: url.origin, path: url.pathname };
      requests.push(request);
      journal('request', request);
    });
    await ctx.session.hook('http.response', event => journal('response', { kind: event.kind, status: event.response.status }));
    await ctx.tool.hook('execute.before', event => journal('tool-start', { id: event.id, tool: event.tool, input: event.input }));
    await ctx.tool.hook('execute.after', event => {
      const call = { sessionID: event.sessionID, id: event.id, tool: event.tool, input: event.input, status: event.status,
        ...(event.status === 'completed' ? { result: event.result } : { error: event.error }) };
      calls.push(call);
      journal('tool-end', call);
    });
  },
});

console.log('checkpoint: model creating host', directory, JSON.stringify(model));
const host = await OpenCode.create({
  plugins: [plugin], models: { fetch: false },
  config: { project: false, content: JSON.stringify({ snapshots: false }) },
});
const abort = new AbortController();
const timer = setTimeout(() => abort.abort(), 180000);
let stream;
let pump;
let streamError;
try {
  const location = { directory };
  await host.plugin.awaitActivation({ location });
  const models = (await host.model.list({ location })).data;
  console.log('checkpoint: available models', JSON.stringify(models.map(item => ({ id: item.id, providerID: item.providerID }))));
  const selected = models.find(item => item.providerID === model.providerID && item.id === model.id);
  assert(selected, `Model unavailable: ${model.providerID}/${model.id}`);
  assert(selected.cost.every(tier => tier.input === 0 && tier.output === 0), 'Qualification requires a free model');
  stream = host.events.subscribe({ signal: abort.signal })[Symbol.asyncIterator]();
  assert.equal((await stream.next()).value?.type, 'server.connected');
  const session = await host.sessions.create({ location, model, agent: 'build', title: 'Browser model qualification' });
  sessionID = session.id;
  console.log('checkpoint: model session', sessionID);
  let terminalEvent;
  const terminal = new Promise((resolve, reject) => {
    terminalEvent = resolve;
    abort.signal.addEventListener('abort', () => reject(Error('Model event stream timed out or aborted')), { once: true });
  });
  // Attach a handler immediately, including while prompt admission is in flight.
  terminal.catch(() => {});
  pump = (async () => {
    for (;;) {
      const next = await stream.next();
      if (next.done) break;
      const event = next.value;
      if (event.data?.sessionID !== sessionID) continue;
      eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
      if (event.type === 'session.text.delta' || event.type === 'session.step.failed') journal('event', event);
      if (['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted'].includes(event.type)) terminalEvent(event);
    }
  })().catch(error => { if (!abort.signal.aborted) streamError = error; });
  await host.sessions.prompt({ sessionID, text: `Find and fix the bug in this tiny CommonJS fixture. Discover the .cjs files with glob, read the implementation and test, and use grep to locate the implementation expression. Run node sum.test.cjs BEFORE editing to observe its assertion failure. Fix only sum.cjs using the edit tool, then run the same test again and report the result. Use relative file paths and workdir ${directory} for shell calls. Do not change the test. Do not delegate.` }, { signal: abort.signal });
  await host.sessions.wait({ sessionID }, { signal: abort.signal });
  const finished = await terminal;
  journal('event-counts', eventCounts);
  if (streamError) throw streamError;
  const context = await host.sessions.context({ sessionID });
  const failed = context.find(message => message.type === 'assistant' && message.error);
  if (failed) throw Error(`Model failed: ${JSON.stringify(failed.error)}`);
  assert.equal(finished.type, 'session.execution.succeeded', 'Model execution did not succeed');
  const completed = calls.filter(call => call.sessionID === sessionID && call.status === 'completed');
  const before = completed.findIndex(call => call.tool === 'shell' && call.input.command === 'node sum.test.cjs' && call.result.output?.exit === 1 && /AssertionError|ERR_ASSERTION/.test(call.result.output.output));
  const edit = completed.findIndex(call => call.tool === 'edit');
  const after = completed.findIndex((call, index) => index > edit && call.tool === 'shell' && call.input.command === 'node sum.test.cjs' && call.result.output?.exit === 0 && call.result.output.output.includes('fixture test passed'));
  assert(before >= 0 && edit > before && after > edit, 'Expected model-driven failing test → edit → passing test');
  for (const tool of ['read', 'edit', 'shell', 'glob', 'grep']) assert(completed.some(call => call.tool === tool), `Model did not successfully use ${tool}`);
  assert(eventCounts['session.text.delta'] > 0, 'Missing streamed model text');
  assert(eventCounts['session.tool.called'] > 0, 'Missing streamed tool calls');
  assert(!eventCounts['session.step.failed'], 'Model step failed');
  assert(requests.some(request => request.kind === 'primary'), 'Missing real provider request');
  assert.notEqual(fs.readFileSync(`${directory}/sum.cjs`, 'utf8'), original);
  assert.equal(fs.readFileSync(`${directory}/sum.test.cjs`, 'utf8'), test);
  const receipt = { sessionID, directory, model, calls: completed.length, tools: [...new Set(completed.map(call => call.tool))], eventCounts, requests, before, edit, after };
  fs.writeFileSync(`${directory}/receipt.json`, JSON.stringify(receipt, null, 2) + '\n');
  console.log('checkpoint: model receipt', JSON.stringify(receipt));
} catch (error) {
  const failure = { sessionID, directory, model, eventCounts, requests, error: String(error) };
  fs.writeFileSync(`${directory}/failure.json`, JSON.stringify(failure, null, 2) + '\n');
  console.log('checkpoint: model failed', JSON.stringify(failure));
  throw error;
} finally {
  clearTimeout(timer);
  if (sessionID) await host.sessions.interrupt({ sessionID, continue: false }).catch(() => {});
  abort.abort();
  await pump;
  await stream?.return?.();
  await host.close();
  console.log('checkpoint: model host closed');
}
console.log('checkpoint: model passed');

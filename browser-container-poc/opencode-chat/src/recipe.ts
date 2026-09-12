import type { Endpoint, Distribution } from '@kev-browser-agent-kit/workspace';
import type { WorkspaceController, Connection } from '@kev-browser-agent-kit/workspace/react';
import { sourcePaths } from './editor-source';
import { loadPrepared, preparedApps, type PreparedManifest } from './prepared';
import { createOpenCodeCandidateConfig, createOpenCodeCandidateLaunch, openCodeCandidateLaunch } from './opencode-launch';

/** Readiness is a real configured provider barrier, not just an HTTP listener. */
export async function verifyOpenCodeReady(endpoint: Pick<Endpoint, 'fetch'>, authorization: string, signal: AbortSignal) {
  const descriptor = openCodeCandidateLaunch;
  const request = (path: string, method = 'GET', timeout = 20000) => endpoint.fetch(path, {
    method, headers: { authorization }, signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
  });
  const deadline = Date.now() + 30000;
  while (true) {
    signal.throwIfAborted();
    const health = await request(descriptor.healthPath, 'GET', 3000);
    await health.arrayBuffer();
    if (health.ok) break;
    if (Date.now() >= deadline) throw Error(`OpenCode health HTTP ${health.status}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const activated = await request(descriptor.activation.path, descriptor.activation.method);
  await activated.arrayBuffer();
  if (!activated.ok) throw Error(`OpenCode plugin activation HTTP ${activated.status}`);
  const configuration = await request(descriptor.configAPIPath);
  if (!configuration.ok) throw Error(`OpenCode configuration HTTP ${configuration.status}`);
  const entries = await configuration.json();
  if (!Array.isArray(entries) || !entries.some(entry => entry.type === 'document' && entry.path === descriptor.configPath
    && entry.info?.providers?.opencode?.models?.[descriptor.model.id]?.package === '@opencode/ai/providers/openai'
    && entry.info.providers.opencode.models[descriptor.model.id].websocket === false)) throw Error('OpenCode global model configuration not loaded');
  const catalog = await request(descriptor.modelPath);
  if (!catalog.ok) throw Error(`OpenCode model catalog HTTP ${catalog.status}`);
  const { data } = await catalog.json();
  if (!Array.isArray(data) || !data.some(model => model.providerID === descriptor.model.providerID && model.id === descriptor.model.id
    && model.enabled && model.capabilities?.tools)) throw Error('Qualified OpenCode model is not enabled with tools');
}

function connection(endpoint: Endpoint, authorization?: string): Connection {
  return { url: endpoint.url, async fetch(input, init) {
    const request = new Request(input instanceof Request ? input : new URL(String(input), endpoint.url), init);
    const headers = new Headers(request.headers);
    if (authorization) headers.set('authorization', authorization);
    return endpoint.fetch(request.url, { method: request.method, headers, signal: request.signal,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer() });
  } };
}

/** Prepared Vite + pinned OpenCode orchestration over the existing workspace API. */
export function createBrowserEditorRecipe(options: { base?: string; model?: string } = {}) {
  if (options.model && options.model !== 'opencode/' + openCodeCandidateLaunch.model.id) throw Error('Browser editor requires the qualified OpenCode Muse Spark model');
  const base = options.base ?? '/editor/';
  return { async start(controller: WorkspaceController) {
    let manifest!: PreparedManifest, distribution!: Distribution;
    await controller.steps([
      ['Load editor preparation', async () => {
        manifest = await loadPrepared(base + 'prepared/', controller.signal);
        const response = await fetch(base + 'runtime/distribution.json', { signal: controller.signal });
        if (!response.ok) throw Error(`Runtime unavailable: HTTP ${response.status}`);
        const runtime = await response.json();
        if (runtime.version !== manifest.runtimeVersion) throw Error('Prepared runtime version mismatch');
        distribution = { name: 'vivari', version: runtime.version, assetBaseUrl: base + 'runtime/' };
      }],
      ['Open local workspace', async () => { await controller.open(distribution); }],
      ['Seed missing application source', async () => {
        const workspace = controller.workspace!;
        const existing = new Set(await sourcePaths(workspace));
        for (const [path, text] of Object.entries(manifest.project)) {
          if (existing.has(path)) continue;
          await workspace.fs.mkdir(path.slice(0, path.lastIndexOf('/')) || '/');
          await workspace.fs.writeFile(path, text);
        }
        for (const directory of openCodeCandidateLaunch.workspaceDirectories) await workspace.fs.mkdir(directory);
        await workspace.fs.writeFile(openCodeCandidateLaunch.workspaceConfigPath, JSON.stringify(createOpenCodeCandidateConfig(
          `http://host.vivari.internal:${location.port || (location.protocol === 'https:' ? '443' : '80')}${base}model/`, ['shell'])));
        await workspace.flush();
      }],
      ['Start runtime and deliver verified applications', async () => {
        if (!controller.runtime) {
          const runtime = await controller.startRuntime({ apps: preparedApps(manifest, base + 'prepared/', controller.signal, controller.log) });
          await runtime.tools.apps();
        }
      }],
      ['Start application preview', async () => {
        await controller.launch('vite', manifest.preview, 5173, async endpoint => {
          const response = await endpoint.fetch('/', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]) });
          if (!response.ok) throw Error(`Preview HTTP ${response.status}: ${(await response.text()).slice(0, 1000)}`);
          return connection(endpoint);
        });
        await controller.waitForClient('vite');
      }],
      ['Start OpenCode', async () => {
        const password = crypto.randomUUID() + crypto.randomUUID();
        const authorization = 'Basic ' + btoa('opencode:' + password);
        await controller.launch('chat', createOpenCodeCandidateLaunch({ password, ripgrepBinDirectory: manifest.opencode.support.binDirectory }), openCodeCandidateLaunch.port, async endpoint => {
          await verifyOpenCodeReady(endpoint, authorization, controller.signal);
          return connection(endpoint, authorization);
        }, { shutdown: 'stdin-eof', timeoutMs: 10000 });
        await controller.waitForClient('chat');
      }],
    ]);
    controller.status('Ready. Source changes save locally in this browser; remote Git persistence is not connected.');
  } };
}

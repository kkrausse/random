import type { Endpoint, Distribution } from '@kev-browser-agent-kit/workspace';
import type { WorkspaceController, Connection } from '@kev-browser-agent-kit/workspace/react';
import { attachChat } from './editor-adapter';
import { sourcePaths } from './editor-source';
import { loadPrepared, preparedApps, type PreparedManifest } from './prepared';

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
        await workspace.fs.writeFile('/opencode.json', JSON.stringify({ model: options.model ?? 'opencode/muse-spark-1.3-contributor-free', snapshots: false,
          providers: { opencode: { settings: { baseURL: `http://host.vivari.internal:${location.port || (location.protocol === 'https:' ? '443' : '80')}${base}model/` } } },
          permissions: [{ action: 'read', resource: '*', effect: 'allow' }, { action: 'edit', resource: '*', effect: 'allow' }] }));
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
        const service = await controller.launch('chat', { entry: '/opencode-v2/run.cjs', args: ['serve', '--port', '4096'], cwd: '/workspace', env: {
          OPENCODE_SERVER_PASSWORD: password, OPENCODE_MODELS_PATH: '/opencode-v2/models.json', OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_FFF: '1', OPENCODE_DISABLE_FILEWATCHER: '1', OTUI_TREE_SITTER_WORKER_PATH: '/opencode-v2/parser/entry.cjs',
          XDG_DATA_HOME: '/workspace/.opencode-state/data', XDG_CONFIG_HOME: '/workspace/.opencode-state/config', XDG_CACHE_HOME: '/workspace/.opencode-state/cache', XDG_STATE_HOME: '/workspace/.opencode-state/state',
        } }, 4096, async endpoint => {
          const deadline = Date.now() + 30000;
          while (true) {
            controller.signal.throwIfAborted();
            const response = await endpoint.fetch('/api/health', { headers: { authorization }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]) });
            if (response.ok) return connection(endpoint, authorization);
            if (Date.now() >= deadline) throw Error(`OpenCode health HTTP ${response.status}`);
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        });
        await attachChat(controller, service);
      }],
    ]);
    controller.status('Ready. Source changes save locally in this browser; remote Git persistence is not connected.');
  } };
}

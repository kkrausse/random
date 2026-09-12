import type { ToolDescriptor, NodeLaunchOptions } from '@kev-browser-agent-kit/workspace';
import { treeInstaller, validateTree, type PreparedEntry } from './package-tree';
import type { DependencyProvenance } from './prepare-dependencies';

export interface PreparedManifest {
  format: 'browser-editor-v2';
  runtimeVersion: string;
  assets: PreparedEntry[];
  dependencies: DependencyProvenance;
  preview: NodeLaunchOptions;
  project: Record<string, string>;
}

export async function loadPrepared(base: string, signal: AbortSignal): Promise<PreparedManifest> {
  const response = await fetch(base + 'manifest.json', { signal });
  if (!response.ok) throw Error(`Editor preparation unavailable: HTTP ${response.status}`);
  const manifest = await response.json() as PreparedManifest;
  if (manifest.format !== 'browser-editor-v2') throw Error('Unsupported editor preparation; regenerate with the current preparer');
  validateTree(manifest.assets);
  if (manifest.dependencies.policy.runtimeVersion !== manifest.runtimeVersion) throw Error('Prepared backend policy runtime mismatch');
  for (const path of Object.keys(manifest.project)) if (!path.startsWith('/') || path.split('/').slice(1).some(part => !part || part === '.' || part === '..' || /[\\\0]/.test(part)) || path === '/node_modules' || path.startsWith('/node_modules/')) throw Error('Invalid prepared source path');
  return manifest;
}

export function preparedApps(manifest: PreparedManifest, base: string, signal: AbortSignal, report: (text: string) => void): ToolDescriptor<void, void> {
  return { name: 'browser-editor-apps', version: manifest.runtimeVersion, async bind(context) {
    return async () => {
      validateTree(manifest.assets);
      async function metadata(phase: 'reset' | 'metadata') {
        const script = new TextEncoder().encode(treeInstaller(manifest.assets, phase));
        const identity = [...new Uint8Array(await crypto.subtle.digest('SHA-256', script))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        const entry = `/tmp/browser-editor-tree-${phase}-${identity}.cjs`;
        await context.installFile(entry, script);
        const child = await context.node({ entry, signal });
        let output = '';
        const consume = async (stream: AsyncIterable<Uint8Array>) => {
          for await (const bytes of stream) output = (output + new TextDecoder().decode(bytes)).slice(-16000);
        };
        const readers = Promise.all([consume(child.stdout), consume(child.stderr)]);
        const result = await child.exited;
        await readers;
        if (result.exitCode !== 0 || result.signal || result.forced || !output.includes(`prepared-tree-${phase}-complete`)) throw Error(`Prepared tree ${phase} failed: ${output}`);
      }
      await metadata('reset');
      let done = 0;
      for (const asset of manifest.assets) {
        if (asset.kind !== 'file') continue;
        signal.throwIfAborted();
        const response = await fetch(base + asset.file, { signal });
        if (!response.ok) throw Error(`Prepared asset HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
        if (bytes.length !== asset.bytes || hash !== asset.sha256) throw Error(`Asset integrity failure: ${asset.destination}`);
        await context.installFile(asset.destination, bytes);
        if (++done % 250 === 0) report(`Installed ${done}/${manifest.assets.length} verified files`);
      }
      await metadata('metadata');
    };
  } };
}

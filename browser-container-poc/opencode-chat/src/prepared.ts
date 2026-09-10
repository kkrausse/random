import type { ToolDescriptor, NodeLaunchOptions } from '@kev-browser-agent-kit/workspace';

export interface PreparedManifest {
  format: 'browser-editor-v1';
  runtimeVersion: string;
  assets: { file: string; destination: string; bytes: number; sha256: string }[];
  preview: NodeLaunchOptions;
  project: Record<string, string>;
}

export async function loadPrepared(base: string, signal: AbortSignal): Promise<PreparedManifest> {
  const response = await fetch(base + 'manifest.json', { signal });
  if (!response.ok) throw Error(`Editor preparation unavailable: HTTP ${response.status}`);
  const manifest = await response.json() as PreparedManifest;
  if (manifest.format !== 'browser-editor-v1') throw Error('Unsupported editor preparation');
  const seen = new Set<string>();
  for (const asset of manifest.assets) {
    if (!/^[a-f0-9]{64}\.bin$/.test(asset.file) || asset.file !== asset.sha256 + '.bin'
      || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0
      || !['/workspace/node_modules/', '/opencode-v2/'].some(prefix => asset.destination.startsWith(prefix))
      || asset.destination.split('/').some(part => part === '.' || part === '..' || part.includes('\\'))
      || seen.has(asset.destination)) throw Error('Invalid prepared asset');
    seen.add(asset.destination);
  }
  return manifest;
}

export function preparedApps(manifest: PreparedManifest, base: string, signal: AbortSignal, report: (text: string) => void): ToolDescriptor<void, void> {
  return { name: 'browser-editor-apps', version: manifest.runtimeVersion, async bind(context) {
    return async () => {
      let done = 0;
      for (const asset of manifest.assets) {
        signal.throwIfAborted();
        const response = await fetch(base + asset.file, { signal });
        if (!response.ok) throw Error(`Prepared asset HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
        if (bytes.length !== asset.bytes || hash !== asset.sha256) throw Error(`Asset integrity failure: ${asset.destination}`);
        await context.installFile(asset.destination, bytes);
        if (++done % 250 === 0) report(`Installed ${done}/${manifest.assets.length} verified files`);
      }
    };
  } };
}

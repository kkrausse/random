// Generic file delivery for the pinned, unmodified integration packages.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { integrationRoot } from './runtime-source.mjs';

export const installation = resolve(integrationRoot, 'probes/ripgrep/node_modules');
export const packages = ['ripgrep', 'which', 'isexe'];
export function directAssets() {
  const assets = [];
  function collect(directory, relative) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory()) collect(resolve(directory, entry.name), file);
      else {
        if (!entry.isFile()) throw Error('Unexpected package entry: ' + file);
        const bytes = readFileSync(resolve(directory, entry.name));
        assets.push({ file, path: '/direct/node_modules/' + file, bytes,
          sha256: createHash('sha256').update(bytes).digest('hex') });
      }
    }
  }
  for (const name of packages) collect(resolve(installation, name), name);
  return assets;
}

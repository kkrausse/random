import { resolve, dirname } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

/** Excludes the app-owned editor entry from guest module resolution, including its imports. */
export function browserEditorBoundary(module: string, privateEntry?: string): Plugin {
  let boundary: string;
  return { name: 'browser-editor-boundary', enforce: 'pre',
    configResolved(config) { boundary = resolve(config.root, module); },
    load(id) {
      if (process.env.BROWSER_AGENT_GUEST === '1' && id.split('?')[0] === boundary) return 'export default function Editor(){return null}';
    },
    generateBundle(_, bundle) {
      if (!privateEntry || process.env.BROWSER_AGENT_GUEST === '1') return;
      const chunks = Object.values(bundle).filter(item => item.type === 'chunk');
      const entry = chunks.find(chunk => chunk.facadeModuleId?.endsWith('/' + privateEntry));
      if (!entry) return;
      const walk = (names: string[], skip?: string) => {
        const visited = new Set<string>();
        const visit = (name: string) => {
          if (visited.has(name) || name === skip) return;
          visited.add(name);
          const chunk = bundle[name];
          if (chunk?.type === 'chunk') {
            for (const dependency of [...chunk.imports, ...chunk.dynamicImports]) visit(dependency);
            const metadata = (chunk as typeof chunk & { viteMetadata?: { importedCss: Set<string>; importedAssets: Set<string> } }).viteMetadata;
            for (const asset of [...(metadata?.importedCss ?? []), ...(metadata?.importedAssets ?? [])]) visited.add(asset);
          }
        };
        names.forEach(visit); return visited;
      };
      const publicFiles = walk(chunks.filter(chunk => chunk.isEntry).map(chunk => chunk.fileName), entry.fileName);
      const privateFiles = [...walk([entry.fileName])].filter(name => !publicFiles.has(name)).map(name => '/' + name);
      this.emitFile({ type: 'asset', fileName: 'editor-assets.json', source: JSON.stringify(privateFiles) });
    },
  };
}

/** Same Tailwind compiler in both environments; the guest uses JS source discovery.
 * Avoids native oxide/lightningcss addons, which cannot execute in a browser runtime.
 */
export async function browserCompatibleTailwind(): Promise<Plugin[]> {
  if (process.env.BROWSER_AGENT_GUEST !== '1') {
    const { default: tailwind } = await import('@tailwindcss/vite');
    return tailwind();
  }
  const { compile } = await import('tailwindcss');
  let root = '/workspace';
  const cssModules = new Set<string>();
  async function candidates(directory: string): Promise<string[]> {
    const result: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (['node_modules', '.git', '.react-router', '.opencode-state', 'build'].includes(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) result.push(...await candidates(path));
      else if (/\.(tsx?|jsx?|html)$/.test(path)) result.push(...(await readFile(path, 'utf8')).split(/[\s"'`<>={}]+/));
    }
    return result;
  }
  return [{ name: 'browser-tailwind', enforce: 'pre', configResolved(config) { root = config.root; },
    async transform(code, id) {
      if (!id.split('?')[0]!.endsWith('.css') || !/@import\s+['"]tailwindcss|@theme|@tailwind/.test(code)) return;
      cssModules.add(id);
      const compiler = await compile(code, { base: dirname(id.split('?')[0]!),
        async loadStylesheet(name, base) {
          const require = createRequire(resolve(base, 'package.json'));
          let path = require.resolve(name);
          if (!path.endsWith('.css') && !name.startsWith('.')) {
            const packageName = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]!;
            const packagePath = require.resolve(packageName + '/package.json');
            const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
            const subpath = '.' + name.slice(packageName.length);
            const style = pkg.exports?.[subpath]?.style ?? (subpath === '.' ? pkg.style : undefined);
            if (!style) throw Error(`No CSS export for ${name}`);
            path = resolve(dirname(packagePath), style);
          }
          return { path, base: dirname(path), content: await readFile(path, 'utf8') };
        },
        async loadModule(name, base) {
          const path = createRequire(resolve(base, 'package.json')).resolve(name);
          const module = await import(path);
          return { path, base: dirname(path), module: module.default ?? module };
        },
      });
      return { code: compiler.build(await candidates(root)), map: null };
    },
    handleHotUpdate(context) {
      if (!/\.(tsx?|jsx?|html)$/.test(context.file)) return;
      return [...context.modules, ...[...cssModules].flatMap(id => {
        const module = context.server.moduleGraph.getModuleById(id);
        if (!module) return [];
        context.server.moduleGraph.invalidateModule(module);
        return [module];
      })];
    },
  }];
}

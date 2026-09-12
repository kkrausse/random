import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { resolve, join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { sha256 } from './prepare-tree';

type Lock = { lockfileVersion: number; packages: Record<string, any[]> };
export interface BackendPolicy { runtimeVersion: string; sha256: string; aliases: Record<string, string> }
export interface DependencyProvenance {
  installer: string;
  linker: 'isolated';
  original: { manifest: string; lock: string; manifestSha256: string; lockSha256: string };
  derived: { manifest: string; lock: string; manifestSha256: string; lockSha256: string };
  policy: BackendPolicy;
  overrides: Record<string, string>;
  backendAssertions: { path: string; name: string; version: string }[];
  lockChanges: { changed: string[]; added: string[]; removed: string[] };
}

export function parseLock(text: string): Lock {
  const lock = Bun.JSONC.parse(text) as Lock;
  if (lock.lockfileVersion !== 1 || !lock.packages) throw Error('Preparation requires Bun text lockfile v1');
  return lock;
}

export function selectBackends(lock: Lock, policy: BackendPolicy) {
  const overrides: Record<string, string> = {};
  const assertions: { path: string; name: string; version: string }[] = [];
  for (const [source, target] of Object.entries(policy.aliases)) {
    const versions = new Set(Object.values(lock.packages).map(entry => entry[0]).filter((id): id is string => typeof id === 'string' && id.startsWith(source + '@')).map(id => id.slice(source.length + 1)));
    if (versions.size > 1) throw Error(`Multiple locked versions of ${source}: exact root override cannot preserve them`);
    if (!versions.size) continue;
    const version = [...versions][0]!;
    if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw Error(`Unsupported locked backend version: ${source}@${version}`);
    overrides[source] = `npm:${target}@${version}`;
    assertions.push({ path: source, name: target, version });
  }
  const oxide = '@tailwindcss/oxide-wasm32-wasi';
  const entries = Object.values(lock.packages).filter(entry => typeof entry[0] === 'string' && entry[0].startsWith(oxide + '@'));
  if (entries.length) {
    const versions = new Set(entries.map(entry => entry[0].slice(oxide.length + 1)));
    if (versions.size !== 1 || [...versions][0] !== '4.3.3') throw Error('Oxide tarball delivery is qualified only for locked 4.3.3');
    overrides[oxide] = 'https://registry.npmjs.org/@tailwindcss/oxide-wasm32-wasi/-/oxide-wasm32-wasi-4.3.3.tgz';
    if (entries.some(entry => !entry.some(value => typeof value === 'string' && value.startsWith('sha512-')))) throw Error('Original Oxide archive integrity is missing');
    assertions.push({ path: oxide, name: oxide, version: '4.3.3' });
  }
  return { overrides, assertions };
}

/** Bun owns resolution, local package copying, scripts and dependency closure. */
export async function prepareDependencies(options: { appRoot: string; source: string[]; policy: BackendPolicy; bunExecutable?: string }) {
  const root = resolve(options.appRoot);
  const temporary = await mkdtemp(join(tmpdir(), 'browser-editor-install-'));
  const install = join(temporary, 'tree', root.slice(1));
  const cleanup = () => rm(temporary, { recursive: true, force: true });
  try {
    const manifest = await readFile(join(root, 'package.json'), 'utf8');
    const lock = await readFile(join(root, 'bun.lock'), 'utf8');
    const pkg = JSON.parse(manifest), originalLock = parseLock(lock);
    if (pkg.workspaces) throw Error('Workspace-root preparation is not yet supported');
    await mkdir(install, { recursive: true });
    for (const source of options.source) {
      if (!source || source.startsWith('/') || source.split('/').some(part => part === '..' || part === '.git' || part === 'node_modules') || source.includes('\\')) throw Error('Source must be app-relative');
      await cp(join(root, source), join(install, source), { recursive: true, verbatimSymlinks: true });
    }
    // Keep relative file: references identical. Copy declared local package inputs
    // into the same relative layout; Bun performs the actual installation.
    const copied = new Set<string>();
    async function localInputs(directory: string, packageJson: any) {
      for (const value of Object.values({ ...packageJson.dependencies, ...packageJson.devDependencies, ...packageJson.optionalDependencies })) {
        if (typeof value !== 'string' || !value.startsWith('file:')) continue;
        if (value.slice(5).startsWith('/')) throw Error('Absolute file dependencies cannot retain staging provenance');
        const source = resolve(directory, value.slice(5));
        if (source === root || root.startsWith(source + '/')) throw Error('Local dependency cannot contain the application');
        if (copied.has(source)) continue;
        copied.add(source);
        const destination = join(temporary, 'tree', source.slice(1));
        await mkdir(dirname(destination), { recursive: true });
        await cp(source, destination, { recursive: true, verbatimSymlinks: true, filter: path => !['node_modules', '.git'].includes(path.split('/').at(-1)!) });
        if (!source.endsWith('.tgz')) await localInputs(source, JSON.parse(await readFile(join(source, 'package.json'), 'utf8')));
      }
    }
    await localInputs(root, pkg);
    await Bun.write(join(install, 'package.json'), manifest);
    await Bun.write(join(install, 'bun.lock'), lock);
    const bun = options.bunExecutable ?? process.execPath;
    const version = Bun.spawn([bun, '--version'], { stdout: 'pipe' });
    const installer = 'bun ' + (await new Response(version.stdout).text()).trim();
    if (await version.exited) throw Error('Cannot identify Bun installer');
    async function run(args: string[]) {
      const child = Bun.spawn([bun, 'install', '--linker', 'isolated', '--cache-dir', join(temporary, 'cache'), ...args], { cwd: install, stdout: 'inherit', stderr: 'inherit' });
      if (await child.exited) throw Error(`Host dependency installation failed (${args.join(' ')})`);
    }
    await run(['--frozen-lockfile']);
    const { overrides, assertions } = selectBackends(originalLock, options.policy);
    for (const [name, value] of Object.entries(overrides)) if (pkg.overrides?.[name] && pkg.overrides[name] !== value) throw Error(`Project override conflicts with runtime policy: ${name}`);
    const derivedManifest = JSON.stringify({ ...pkg, overrides: { ...pkg.overrides, ...overrides } }, null, 2) + '\n';
    await Bun.write(join(install, 'package.json'), derivedManifest);
    await run([]);
    const derivedLockText = await readFile(join(install, 'bun.lock'), 'utf8');
    const derivedLock = parseLock(derivedLockText);
    for (const assertion of assertions.filter(item => item.name === '@tailwindcss/oxide-wasm32-wasi')) {
      const original = Object.values(originalLock.packages).find(entry => entry[0] === assertion.name + '@' + assertion.version)!;
      const integrity = original.find(value => typeof value === 'string' && value.startsWith('sha512-'));
      if (!Object.entries(derivedLock.packages).some(([key, entry]) => (key === assertion.path || key.endsWith('/' + assertion.path)) && entry.includes(integrity))) throw Error('Derived Oxide archive integrity differs from original lock');
    }
    // Verify reproducibility and platform-filtered delivery, independently of the
    // initial installer cache and node_modules. Scripts follow normal Bun policy.
    await rm(join(install, 'node_modules'), { recursive: true, force: true });
    await run(['--frozen-lockfile', '--cache-dir', join(temporary, 'verification-cache')]);
    if (await readFile(join(install, 'bun.lock'), 'utf8') !== derivedLockText) throw Error('Frozen runtime lock changed');
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      try { await readFile(join(install, 'node_modules', name, 'package.json')); }
      catch (cause) { throw Error(`Required project dependency was not installed: ${name}`, { cause }); }
    }
    const installed: { directory: string; name: string; version: string }[] = [];
    async function packages(directory: string) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) await packages(join(directory, entry.name));
        else if (entry.isFile() && entry.name === 'package.json') {
          // Inspect actual isolated package roots, not package.json fixtures or
          // arbitrary bundled data which happens to have the same filename.
          if (!/^\.bun\/[^/]+\/node_modules\/(?:@[^/]+\/)?[^/]+$/.test(relative(join(install, 'node_modules'), directory))) continue;
          const pkg = JSON.parse(await readFile(join(directory, entry.name), 'utf8'));
          installed.push({ directory, name: pkg.name, version: pkg.version });
        }
      }
    }
    await packages(join(install, 'node_modules'));
    const backendAssertions: DependencyProvenance['backendAssertions'] = [];
    for (const assertion of assertions) {
      const actual = installed.find(pkg => pkg.name === assertion.name && pkg.version === assertion.version);
      if (!actual) throw Error(`Missing or incorrect runtime backend: ${assertion.path}`);
      const payload = assertion.path === 'esbuild' ? 'esbuild.wasm' : assertion.path === 'rollup' ? 'dist/wasm-node/bindings_wasm_bg.wasm' : assertion.path === 'lightningcss' ? 'lightningcss_node.wasm' : 'tailwindcss-oxide.wasm32-wasi.wasm';
      await readFile(join(actual.directory, payload));
      backendAssertions.push({ path: relative(join(install, 'node_modules'), actual.directory), name: actual.name, version: actual.version });
    }
    const before = originalLock.packages, after = derivedLock.packages;
    const provenance: DependencyProvenance = {
      installer, linker: 'isolated', original: { manifest, lock, manifestSha256: sha256(manifest), lockSha256: sha256(lock) },
      derived: { manifest: derivedManifest, lock: derivedLockText, manifestSha256: sha256(derivedManifest), lockSha256: sha256(derivedLockText) },
      policy: options.policy, overrides, backendAssertions,
      lockChanges: { changed: Object.keys(before).filter(key => key in after && JSON.stringify(before[key]) !== JSON.stringify(after[key])), added: Object.keys(after).filter(key => !(key in before)), removed: Object.keys(before).filter(key => !(key in after)) },
    };
    return { install, provenance, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

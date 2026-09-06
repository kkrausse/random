// Isolated packaging; never installs into the harness or changes its lockfile.
import { resolve, join } from 'node:path';
import { mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dir, '..');
const temp = await mkdtemp(join(tmpdir(), 'vivari-editor-sidequest-'));
await Bun.write(join(temp, 'package.json'), JSON.stringify({ private: true, dependencies: {
  'js-vim': '0.4.2', 'mauve': '1.1.2', 'get-set': '0.1.0',
  'underscore': '1.4.4', 'js-vim-command': '0.6.0', 'diff_match_patch': '0.1.1',
  'rgb': '0.0.1', 'x256': '0.0.1',
}, overrides: { x256: '0.0.1' } }));
const install = Bun.spawn(['bun', 'install'], { cwd: temp, stdout: 'inherit', stderr: 'inherit' });
if (await install.exited) throw Error('Isolated editor install failed');
await Bun.write(join(temp, 'guest.cjs'), await Bun.file(join(root, 'probes/editor-sidequest/guest.cjs')).text());
const out = join(root, '.runtime/editor-sidequest');
await mkdir(out, { recursive: true });
for (const name of await readdir(join(temp, 'node_modules'))) {
  if (name.startsWith('.')) continue;
  const dir = join(temp, 'node_modules', name);
  for (const file of await readdir(dir)) {
    if (/^(license|copying|readme|package\.json)/i.test(file)) {
      await Bun.write(join(out, 'licenses', name, file), Bun.file(join(dir, file)));
    }
  }
}
const result = await Bun.build({
  entrypoints: [join(temp, 'guest.cjs')], target: 'node', format: 'cjs',
  plugins: [{ name: 'mauve-node-detection', setup(build) {
    build.onLoad({ filter: /\/x256\/index\.js$/ }, async ({ path }) => {
      const source = await Bun.file(path).text();
      const loader = 'JSON.parse(fs.readFileSync(__dirname + \'/colors.json\'))';
      if (!source.includes(loader)) throw Error('Unexpected x256 asset loader');
      const colors = await Bun.file(join(temp, 'node_modules/x256/colors.json')).text();
      return { contents: source.replace(loader, colors.trim()), loader: 'js' };
    });
    build.onLoad({ filter: /\/mauve\/index\.js$/ }, async ({ path }) => {
      const source = await Bun.file(path).text();
      const broken = "typeof window !== 'undefined' || !document.getElementsById('terminals')";
      if (!source.includes(broken)) throw Error('Unexpected mauve source');
      // Published mauve dereferences document in Node/workers. Select its existing
      // Node ANSI branch; no fake browser globals or runtime patch is introduced.
      return { contents: source.replace(broken, "typeof window !== 'undefined'"), loader: 'js' };
    });
  } }],
});
if (!result.success) throw Error(result.logs.join('\n'));
const bytes = await result.outputs[0].arrayBuffer();
await Bun.write(join(out, 'editor-sidequest.cjs'), bytes);
await Bun.write(join(out, 'bun.lock'), await Bun.file(join(temp, 'bun.lock')).text());
await Bun.write(join(out, 'metadata.json'), JSON.stringify({
  engine: 'js-vim@0.4.2', license: 'MIT',
  sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
  adaptation: 'mauve Node branch document guard; inline x256 colors asset; guest fs/stdin/stdout adapter',
  temp,
}, null, 2));
console.log(out);

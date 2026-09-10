import { dirname, join } from "node:path";

/** UI implementation dependencies are bundled, rather than required by headless consumers. */
export async function uiLicenses() {
  const visited = new Set<string>();
  const sections: string[] = [];
  async function collect(name: string, from: string) {
    if (visited.has(name)) return;
    visited.add(name);
    const packagePath = Bun.resolveSync(`${name}/package.json`, from);
    const root = dirname(packagePath);
    const manifest = await Bun.file(packagePath).json();
    const files = [...new Bun.Glob("*").scanSync(root)].filter(file => /^(licen[cs]e|notice)(\.|$)/i.test(file));
    if (!files.length) throw Error(`Missing bundled dependency license: ${name}`);
    sections.push(`${name} ${manifest.version}\n${(await Promise.all(files.map(file => Bun.file(join(root, file)).text()))).join("\n")}`);
    for (const dependency of Object.keys(manifest.dependencies ?? {})) await collect(dependency, root);
  }
  for (const name of ["@base-ui/react", "lucide-react", "class-variance-authority", "clsx", "tailwind-merge"]) await collect(name, import.meta.dir);
  return sections.join("\n\n---\n\n");
}

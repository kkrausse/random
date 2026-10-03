import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "artifact-test-"));
  dirs.push(dir);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  // Execute remote commands locally; rsync's destination host is stripped.
  writeFileSync(join(bin, "ssh"), '#!/bin/bash\nshift\nexec bash -c "$1"\n', { mode: 0o755 });
  writeFileSync(join(bin, "sudo"), '#!/bin/bash\nexec "$@"\n', { mode: 0o755 });
  writeFileSync(join(bin, "rsync"), `#!/bin/bash
args=()
for arg in "$@"; do [[ "$arg" == -* ]] || args+=("$arg"); done
src="\${args[0]}"
dest="\${args[1]}"
[[ "$dest" == *:* ]] && dest="\${dest#*:}"
mkdir -p "$(dirname "$dest")"
if [[ -d "$src" ]]; then mkdir -p "$dest"; cp -R "$src". "$dest"; else cp "$src" "$dest"; fi
`, { mode: 0o755 });
  const privateRoot = join(dir, "private");
  const publicRoot = join(dir, "public");
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    DEPLOY_PRIVATE_ROOT: privateRoot,
    DEPLOY_WEB_ROOT: publicRoot,
    DEPLOY_PRIVATE_URL: "https://private.example",
    DEPLOY_PUBLIC_URL: "https://public.example",
  };
  const run = (...args: string[]) => Bun.spawnSync(["bash", join(import.meta.dir, "deploy-artifact.sh"), ...args], { env });
  return { dir, privateRoot, publicRoot, run };
}

test("default private, explicit public, file landing page, and removal stay separate", () => {
  const { dir, privateRoot, publicRoot, run } = fixture();
  const source = join(dir, "notes & more.txt");
  writeFileSync(source, "hello");
  let result = run(source, "notes");
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("Published (private): https://private.example/artifacts/notes/notes%20%26%20more.txt");
  const landing = readFileSync(join(privateRoot, "artifacts/notes/index.html"), "utf8");
  expect(landing).toContain("notes%20%26%20more.txt");
  expect(landing).toContain("notes &amp; more.txt");
  expect(readFileSync(join(privateRoot, "index.html"), "utf8")).toContain("Private artifacts");
  result = run("--public", source, "notes");
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("Published (public): https://public.example/artifacts/notes/notes%20%26%20more.txt");
  expect(run("--remove", "notes").exitCode).toBe(0);
  expect(readFileSync(join(privateRoot, "index.html"), "utf8")).toContain("No artifacts published yet.");
  expect(readFileSync(join(publicRoot, "artifacts/notes/notes & more.txt"), "utf8")).toBe("hello");
});

test("folders need no HTML; generated listings include nested files without changing sources", () => {
  const { dir, privateRoot, run } = fixture();
  const source = join(dir, "documents");
  mkdirSync(join(source, "nested"), { recursive: true });
  writeFileSync(join(source, "report & notes.pdf"), "pdf bytes");
  writeFileSync(join(source, "nested/image.png"), "image bytes");
  const result = run(source);
  expect(result.exitCode).toBe(0);
  const published = join(privateRoot, "artifacts/documents");
  expect(readFileSync(join(published, "index.html"), "utf8")).toContain('href="report%20%26%20notes.pdf"');
  expect(readFileSync(join(published, "index.html"), "utf8")).toContain('href="nested/"');
  expect(readFileSync(join(published, "nested/index.html"), "utf8")).toContain('href="image.png"');
  expect(existsSync(join(source, "index.html"))).toBe(false);
  expect(existsSync(join(source, "nested/index.html"))).toBe(false);
});

test("existing HTML pages are preserved", () => {
  const { dir, privateRoot, run } = fixture();
  const source = join(dir, "site");
  mkdirSync(source);
  writeFileSync(join(source, "index.html"), "my existing page");
  expect(run(source).exitCode).toBe(0);
  expect(readFileSync(join(privateRoot, "artifacts/site/index.html"), "utf8")).toBe("my existing page");
});

test("index sorts by publish timestamp with source-mtime fallback and deterministic ties", () => {
  const { dir } = fixture();
  for (const [name, sourceTime, publishTime] of [
    ["older", 300, 100], ["newer", 100, 400], ["legacy", 200, null], ["tie", 100, 400],
  ] as const) {
    const path = join(dir, name);
    mkdirSync(path);
    writeFileSync(join(path, "index.html"), "hello");
    utimesSync(join(path, "index.html"), sourceTime, sourceTime);
    if (publishTime !== null) {
      writeFileSync(join(path, ".published-at"), "");
      utimesSync(join(path, ".published-at"), publishTime, publishTime);
    }
  }
  const render = () => Bun.spawnSync(["python3", join(import.meta.dir, "artifact-index.py"), dir, "private"]).stdout.toString();
  let index = render();
  expect(index.indexOf('/newer/')).toBeLessThan(index.indexOf('/tie/'));
  expect(index.indexOf('/tie/')).toBeLessThan(index.indexOf('/legacy/'));
  expect(index.indexOf('/legacy/')).toBeLessThan(index.indexOf('/older/'));
  utimesSync(join(dir, "older/.published-at"), 500, 500);
  index = render();
  expect(index.indexOf('/older/')).toBeLessThan(index.indexOf('/newer/'));
});

test("rejects unsafe slugs, missing input, and private deployment into public web root", () => {
  const { dir, run } = fixture();
  const source = join(dir, "index.html");
  writeFileSync(source, "hello");
  expect(run(source, "../escape").exitCode).not.toBe(0);
  expect(run(join(dir, "missing")).exitCode).not.toBe(0);
  const result = Bun.spawnSync(["bash", join(import.meta.dir, "deploy-artifact.sh"), source], {
    env: { ...process.env, DEPLOY_PRIVATE_ROOT: "/var/www/html/private", DEPLOY_PRIVATE_URL: "https://private.example" },
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("must be outside /var/www");
});

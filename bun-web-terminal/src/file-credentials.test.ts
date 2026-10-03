import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadFileCredentials, resetFileCredentials } from "./file-credentials";
import { decodeCredentials } from "./credentials";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "terminal-credentials-test-"));
  roots.push(root);
  return join(root, "state");
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

test("file credentials survive reloads and use private permissions", async () => {
  const directory = await fixture();
  const first = await loadFileCredentials(directory, 3000);
  expect(await loadFileCredentials(directory, 3000)).toEqual(first);
  expect(decodeCredentials(await readFile(join(directory, "port-3000.auth"), "utf8"))).toEqual(first);
  expect((await stat(directory)).mode & 0o777).toBe(0o700);
  expect((await stat(join(directory, "port-3000.auth"))).mode & 0o777).toBe(0o600);
});

test("concurrent first starts reuse one complete credential file", async () => {
  const directory = await fixture();
  const results = await Promise.all(Array.from({ length: 20 }, () => loadFileCredentials(directory, 3000)));
  for (const result of results) expect(result).toEqual(results[0]);
  expect(await readdir(directory)).toEqual(["port-3000.auth"]);
});

test("reset rotates only the selected port and is idempotent", async () => {
  const directory = await fixture();
  await resetFileCredentials(directory, 3000);
  const first = await loadFileCredentials(directory, 3000);
  const other = await loadFileCredentials(directory, 3107);
  await resetFileCredentials(directory, 3000);
  await resetFileCredentials(directory, 3000);
  expect(await loadFileCredentials(directory, 3000)).not.toEqual(first);
  expect(await loadFileCredentials(directory, 3107)).toEqual(other);
});

test("corrupt credentials stop startup without rotating the file", async () => {
  const directory = await fixture();
  await loadFileCredentials(directory, 3000);
  const path = join(directory, "port-3000.auth");
  await writeFile(path, "corrupt");
  await expect(loadFileCredentials(directory, 3000)).rejects.toThrow("Invalid stored");
  expect(await readFile(path, "utf8")).toBe("corrupt");
});

test("unsafe file and directory permissions fail closed", async () => {
  const directory = await fixture();
  await loadFileCredentials(directory, 3000);
  await chmod(join(directory, "port-3000.auth"), 0o644);
  await expect(loadFileCredentials(directory, 3000)).rejects.toThrow("private (0600)");
  await chmod(directory, 0o755);
  await expect(loadFileCredentials(directory, 3000)).rejects.toThrow("private (0700)");
});

test("symlink credentials and directories are refused", async () => {
  const directory = await fixture();
  await mkdir(directory, { mode: 0o700 });
  const target = join(directory, "target");
  await writeFile(target, "do not touch", { mode: 0o600 });
  await symlink(target, join(directory, "port-3000.auth"));
  await expect(loadFileCredentials(directory, 3000)).rejects.toThrow();
  expect(await readFile(target, "utf8")).toBe("do not touch");
  await symlink(directory, `${directory}-link`);
  await expect(loadFileCredentials(`${directory}-link`, 3000)).rejects.toThrow("not a symlink");
});

test("invalid ports do not create a credential directory", async () => {
  const directory = await fixture();
  for (const port of [0, -1, 65536, NaN, 1.5]) {
    await expect(loadFileCredentials(directory, port)).rejects.toThrow("Invalid terminal port");
  }
  await expect(stat(directory)).rejects.toThrow();
});

test.skipIf(process.platform !== "linux")("Linux public loader reuses XDG credentials across separate processes", async () => {
  const stateHome = await fixture();
  const module = new URL("./credentials.ts", import.meta.url).href;
  const run = async (expression: string) => {
    const child = Bun.spawn([process.execPath, "-e", `import { loadCredentials, resetCredentials } from ${JSON.stringify(module)}; ${expression}`], {
      env: { ...process.env, XDG_STATE_HOME: stateHome }, stdout: "pipe", stderr: "pipe",
    });
    const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(error);
    return output;
  };
  const first = await run("console.log(JSON.stringify(await loadCredentials(3000)));");
  expect(await run("console.log(JSON.stringify(await loadCredentials(3000))); ")).toBe(first);
  expect(await readdir(join(stateHome, "bun-web-terminal"))).toEqual(["port-3000.auth"]);
  await run("await resetCredentials(3000);");
  expect(await run("console.log(JSON.stringify(await loadCredentials(3000))); ")).not.toBe(first);
});

import { Vivari, type FileSystemTree, type VivariProcess } from "@vivari/core";

const files = import.meta.glob("../fixture/**/*", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const status = document.querySelector<HTMLElement>("#status")!;
const output = document.querySelector<HTMLElement>("#output")!;
const preview = document.querySelector<HTMLIFrameElement>("#preview")!;
let vm: Vivari;
let active: VivariProcess | undefined;
let serverStart = 0;
const samples: { phase: string; ms: number; [key: string]: unknown }[] = [];
function log(text: string) { output.textContent += text; output.scrollTop = output.scrollHeight; }
async function run(argv: string[], wait = true) {
  const start = performance.now();
  if (argv.join(" ") === "bun run dev") serverStart = start;
  log(`\n$ ${argv.join(" ")}\n`);
  const proc = await vm.spawn(argv[0], argv.slice(1), { cwd: "/workspace" });
  active = proc;
  const stream = (async () => { for await (const chunk of proc.output) log(chunk); })();
  if (!wait) {
    void stream.catch(error => log(String(error)));
    void proc.exit.then(code => log(`\n${argv.join(" ")} exited: ${code}\n`));
    return;
  }
  const code = await proc.exit;
  await stream;
  samples.push({ phase: argv.join(" "), ms: performance.now() - start, code });
  log(`\nexit: ${code}\n`);
  if (code !== 0) throw new Error(`${argv[0]} exited ${code}`);
}
async function boot() {
  const start = performance.now();
  vm = await Vivari.boot();
  samples.push({ phase: "boot", ms: performance.now() - start });
  // SDK 1.0.0 forwards outbound tunnels but omits kernel -> iframe delivery.
  for (const type of ["vv-ws", "vv-sse"]) {
    vm.bridge.on(type, event => {
      preview.contentWindow?.postMessage({ ...(event.msg as object), type, dir: "in" }, location.origin);
    });
  }
  vm.on("error", error => log(`\nKernel error: ${error.message}\n`));
  vm.bridge.on("log", event => log(`[kernel] ${event.line}\n`));
  vm.on("server-ready", (port, url) => {
    log(`\nServer ready ${port}: ${url}\n`);
    if (serverStart) samples.push({ phase: "server-ready", ms: performance.now() - serverStart, port });
    preview.src = url;
    const deadline = performance.now() + 30000;
    const visible = () => {
      if (preview.contentDocument?.querySelector("h1")?.getBoundingClientRect().height) {
        samples.push({ phase: "first-visible", ms: performance.now() - serverStart, port });
      } else if (performance.now() < deadline) requestAnimationFrame(visible);
    };
    requestAnimationFrame(visible);
  });
  // Preserve Vivari's persisted workspace on subsequent page loads.
  if (!await vm.fs.exists("/workspace/package.json")) {
    const tree: FileSystemTree = {};
    for (const [path, contents] of Object.entries(files)) {
      const parts = path.replace("../fixture/", "").split("/");
      let dir = tree;
      for (const part of parts.slice(0, -1)) {
        const node = dir[part] ??= { directory: {} };
        if (!("directory" in node)) throw new Error(`Invalid tree: ${path}`);
        dir = node.directory;
      }
      dir[parts.at(-1)!] = { file: { contents } };
    }
    await vm.mount(tree, { mountPoint: "/workspace" });
  }
  document.querySelectorAll<HTMLButtonElement>("button").forEach(button => button.disabled = false);
  document.querySelector<HTMLButtonElement>("#boot")!.disabled = true;
  status.textContent = "Runtime ready";
}
function action(id: string, fn: () => Promise<unknown>) {
  document.querySelector(id)!.addEventListener("click", () => {
    status.textContent = "Working…";
    void fn().then(() => { status.textContent = "Ready"; }).catch(error => { status.textContent = String(error); log(`\n${error}\n`); });
  });
}
action("#boot", boot);
action("#install", () => run(["bun", "install", "--frozen-lockfile"]));
action("#dev", () => run(["bun", "run", "dev"], false));
action("#test", () => run(["bun", "test", "test/fixture.test.mjs"]));
action("#stop", async () => active?.kill());
document.querySelector("#command")!.addEventListener("submit", event => {
  event.preventDefault();
  void (async () => {
    const argv: unknown = JSON.parse(document.querySelector<HTMLInputElement>("#args")!.value);
    if (!Array.isArray(argv) || !argv.length || !argv.every(value => typeof value === "string")) throw new Error("Expected a nonempty JSON string array");
    await run(argv);
  })().catch(error => log(`\n${error}\n`));
});
// Browser Control probes use the host clock and real VFS, without a host-side executor.
Object.assign(window, { probe: { get vm() { return vm; }, run, samples, versions: { vivari: "1.0.0", revision: "2629c71097238400c45aefa213ef61df4794c2b7" } } });

import { Vivari, type FileSystemTree, type VivariProcess } from "@vivari/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { runOpenCode } from "./opencode";
import { connectDevBridge } from "./dev-bridge";

const files = import.meta.glob("../fixture/**/*", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const status = document.querySelector<HTMLElement>("#status")!;
const output = document.querySelector<HTMLElement>("#output")!;
const terminal = new Terminal({ convertEol: true, fontSize: 14, scrollback: 5000 });
const fit = new FitAddon();
terminal.loadAddon(fit);
terminal.open(output);
new ResizeObserver(() => fit.fit()).observe(output);
const preview = document.querySelector<HTMLIFrameElement>("#preview")!;
let vm: Vivari;
let ready = false;
let active: VivariProcess | undefined;
let input: WritableStreamDefaultWriter<string> | undefined;
let busy = false;
let demoAbort: AbortController | undefined;
function stop() { demoAbort?.abort(); active?.kill(); }
function setProcess(proc: VivariProcess | undefined) {
  input?.releaseLock();
  active = proc;
  input = proc?.input.getWriter();
}
terminal.onData(data => {
  if (input) void input.write(data).catch(error => log(`\n${error}\n`));
});
let serverStart = 0;
const samples: { phase: string; ms: number; [key: string]: unknown }[] = [];
let transcript = "";
function log(text: string) { transcript = (transcript + text).slice(-1000000); terminal.write(text); }
async function run(argv: string[], wait = true) {
  if (active) throw Error("Stop the active command first");
  const start = performance.now();
  if (argv.join(" ") === "bun run dev") serverStart = start;
  log(`\n$ ${argv.join(" ")}\n`);
  const proc = await vm.spawn(argv[0], argv.slice(1), { cwd: "/workspace" });
  setProcess(proc);
  const stream = (async () => { for await (const chunk of proc.output) log(chunk); })();
  if (!wait) {
    void stream.catch(error => log(String(error)));
    void proc.exit.then(code => { if (active === proc) setProcess(undefined); log(`\n${argv.join(" ")} exited: ${code}\n`); });
    return;
  }
  const code = await proc.exit;
  await stream;
  if (active === proc) setProcess(undefined);
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
  ready = true;
}
function action(id: string, fn: () => Promise<unknown>) {
  document.querySelector(id)!.addEventListener("click", () => {
    if (id !== "#stop" && busy) return;
    if (id === "#stop") { void fn(); return; }
    busy = true;
    status.textContent = "Working…";
    void fn().then(() => { status.textContent = "Ready"; }).catch(error => { status.textContent = String(error); log(`\n${error}\n`); }).finally(() => { busy = false; });
  });
}
action("#boot", boot);
action("#install", () => run(["bun", "install", "--frozen-lockfile"]));
action("#dev", () => run(["bun", "run", "dev"], false));
action("#test", () => run(["bun", "test", "test/fixture.test.mjs"]));
action("#stop", async () => stop());
const shell = document.createElement('button');
shell.textContent = 'Open shell';
document.querySelector('#stop')!.after(shell);
shell.addEventListener('click', () => {
  if (!vm || busy || active) { log('\nBoot the runtime and stop the active command first\n'); return; }
  busy = true;
  void run(['sh'], false).catch(error => log(`\n${error}\n`)).finally(() => { busy = false; terminal.focus(); });
});
for (const [id, recover] of [["#sdk", false], ["#recover", true]] as const) {
  action(id, async () => {
    if (active) throw Error("Stop the active command first");
    log(`\n$ SDK ${recover ? "recover saved session" : "create durable session"}\n`);
    demoAbort = new AbortController();
    Object.assign(window, { sdkDemo: undefined });
    try {
      const result = await runOpenCode(vm, { recover, log, process: setProcess, signal: demoAbort.signal });
      Object.assign(window, { sdkDemo: result });
      log(`\nPASS: SDK ${recover ? "session recovered" : "session created and read back"}, host closed\n`);
    } finally { demoAbort = undefined; }
  });
}
document.querySelector("#command")!.addEventListener("submit", event => {
  event.preventDefault();
  if (busy || active) { log("\nStop the active command first\n"); return; }
  busy = true;
  void (async () => {
    const argv: unknown = JSON.parse(document.querySelector<HTMLInputElement>("#args")!.value);
    if (!Array.isArray(argv) || !argv.length || !argv.every(value => typeof value === "string")) throw new Error("Expected a nonempty JSON string array");
    await run(argv);
  })().catch(error => log(`\n${error}\n`)).finally(() => { busy = false; });
});
// Browser Control probes use the host clock and real VFS, without a host-side executor.
Object.assign(window, { probe: { get vm() { return vm; }, get output() { return transcript; }, run, samples, versions: { vivari: "1.0.0", revision: "2629c71097238400c45aefa213ef61df4794c2b7" } } });
if (import.meta.env.DEV) connectDevBridge({
  vm: () => ready ? vm : undefined, boot, log, logs: () => transcript,
  acquire: () => {
    if (busy || active) throw Error('Runtime busy; stop the active command first');
    busy = true;
    return () => { busy = false; };
  },
});

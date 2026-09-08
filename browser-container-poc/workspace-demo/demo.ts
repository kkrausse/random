import { root, runtimeRoot, sourceRoot, preparedRoot, checkAssets } from "./setup";
import { diagnosticLog } from "./diagnostic-log";
const diagnostics = diagnosticLog(`${root}/.diagnostics`);
const run = crypto.randomUUID();

const port = Number(process.env.PORT ?? 4311);
const url = `http://127.0.0.1:${port}`;
async function command(args: string[]) {
  const child = Bun.spawn([process.execPath, ...args], { cwd: root, stdout: "inherit", stderr: "inherit", stdin: "inherit" });
  const stop = () => child.kill("SIGTERM");
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try { if (await child.exited) throw Error(`Preparation failed: bun ${args.join(" ")}`); }
  finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
}
async function main() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("PORT must be an integer between 1 and 65535");
  if (!await Bun.file(`${runtimeRoot}/distribution.json`).exists()) {
    console.log("Runtime distribution missing; packaging the existing compiled runtime (no automatic runtime rebuild).");
    try { await command(["../workspace-api/scripts/distribution.ts"]); }
    catch { throw Error("Build the pinned runtime first. From browser-container-poc run: bun vivari/scripts/build-runtime.ts patched && bun workspace-api/scripts/distribution.ts. See workspace-demo/README.md for prerequisites."); }
    if (!await Bun.file(`${runtimeRoot}/distribution.json`).exists()) throw Error(`RUNTIME_DIR=${runtimeRoot} has no distribution.json. Point it to workspace-api/dist/runtime or prepare that custom distribution.`);
  }
  if (!await Bun.file(`${sourceRoot}/receipt.json`).exists()) throw Error("Matched OpenCode package missing. From browser-container-poc run bun vivari/scripts/package-opencode-tui.ts --v2 after installing its pinned source checkout. See workspace-demo/README.md; the demo does not fetch or mutate a source checkout for you.");
  let assets = await checkAssets(true);
  if (!assets.ok) {
    console.log(`Preparing apps: ${assets.message}`);
    await command(["run", "prepare"]);
    assets = await checkAssets(true);
    if (!assets.ok) throw Error(assets.message);
  }
  try {
    const response = await fetch(`${url}/demo-info`, { signal: AbortSignal.timeout(1000) });
    const existing = response.ok && response.headers.get("content-type")?.includes("application/json") ? await response.json() : undefined;
    if (existing?.name === "workspace-react-demo" && existing.root === root && existing.runtimeRoot === runtimeRoot && existing.preparedRoot === preparedRoot) {
      console.log(`Reusing Workspace React demo and local model proxy: ${url}\nOpen the URL and click Start workspace. Stop the owning terminal to stop that server.`);
      await diagnostics.write({ time: new Date().toISOString(), run, event: "command.reused", port });
      return;
    }
    throw Error(`Port ${port} is already serving another app. Use its owning terminal to stop it, or run PORT=4312 bun run demo. No existing process was stopped.`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Port ")) throw error;
    // No identifiable HTTP server. Bun.serve reports any remaining bind conflict.
  }
  await import("./serve");
}
const started = performance.now();
await diagnostics.write({ time: new Date().toISOString(), run, event: "command.start", port });
try { await main(); }
catch (error) {
  await diagnostics.write({ time: new Date().toISOString(), run, event: "command.failed", elapsedMs: Math.round(performance.now() - started), error });
  console.error(`Diagnostic run ${run}: ${diagnostics.file}`);
  throw error;
}

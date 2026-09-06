import { join } from "node:path";
import { audioFormat, dictationLimits } from "./dictation-protocol";

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class DictationService {
  private child?: Bun.Subprocess;
  private startup?: Promise<string>;
  private stopped = false;
  private failures = 0;
  private retryAt = 0;
  private external = process.env.DICTATION_URL;
  private url = this.external ?? `http://127.0.0.1:${process.env.DICTATION_PORT ?? "9876"}`;

  constructor() {
    const url = new URL(this.url);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/") {
      throw new Error("DICTATION_URL must be a loopback HTTP origin");
    }
    this.url = url.origin;
  }

  async ensure(): Promise<string> {
    if (this.stopped) throw new Error("Dictation service stopped");
    if (this.external) return this.url;
    if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Dictation requires an Apple Silicon Mac");
    if (this.startup) return this.startup;
    const attempt = this.start().catch(error => {
      // An exited child can allow a fresh request before its startup rejects.
      // Never clear that newer request's shared promise.
      if (this.startup === attempt) this.startup = undefined;
      this.retryAt = Math.max(this.retryAt, Date.now() + Math.min(10_000, 500 * 2 ** this.failures++));
      throw error;
    });
    this.startup = attempt;
    return attempt;
  }

  private async start() {
    await pause(Math.max(0, this.retryAt - Date.now()));
    if (this.stopped) throw new Error("Dictation service stopped");
    const instanceId = crypto.randomUUID();
    const executable = process.env.DICTATION_EXECUTABLE ?? join(import.meta.dir, "../../dictation-server/.build/release/dictation-server");
    const child = Bun.spawn([executable, "--host", "127.0.0.1", "--port", new URL(this.url).port || "80",
      "--instance-id", instanceId, "--parent-pid", String(process.pid),
      ...(process.env.DICTATION_MODEL_DIR ? ["--model-dir", process.env.DICTATION_MODEL_DIR] : [])],
    { stdin: "ignore", stdout: "ignore", stderr: "inherit" });
    this.child = child;
    void child.exited.then(() => {
      if (this.child !== child) return;
      this.child = undefined;
      this.startup = undefined;
      this.retryAt = Date.now() + Math.min(10_000, 500 * 2 ** this.failures++);
    });
    try {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if (this.stopped || child.exitCode !== null) throw new Error("Dictation service exited during startup");
        let health: any;
        try { health = await (await fetch(`${this.url}/healthz`, { signal: AbortSignal.timeout(750) })).json(); } catch {}
        if (health) {
          if (health.instanceId !== instanceId || String(health.version) !== "1") throw new Error("Dictation port collision or protocol mismatch");
          this.failures = 0;
          return this.url;
        }
        await pause(100);
      }
      throw new Error("Dictation service startup timed out");
    } catch (error) {
      await this.terminate(child);
      throw error;
    }
  }

  async status() {
    try {
      const url = await this.ensure();
      const response = await fetch(`${url}/v1/status`, { signal: AbortSignal.timeout(2000) });
      const status = await response.json() as any;
      if (!response.ok || status.version !== 1 || !["loading", "ready", "busy", "error"].includes(status.state)) throw new Error("Invalid service status");
      return { available: status.state !== "error", state: status.state, modelId: status.modelId, audio: audioFormat, limits: dictationLimits };
    } catch {
      return { available: false, state: "error", message: "Dictation unavailable · check the Swift service build and configuration", audio: audioFormat };
    }
  }

  async connect() {
    const url = await this.ensure();
    return new WebSocket(`${url.replace(/^http/, "ws")}/v1/stream`);
  }

  private async terminate(child: Bun.Subprocess) {
    child.kill("SIGTERM");
    await Promise.race([child.exited, pause(2000)]);
    if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; }
  }

  async dispose() {
    this.stopped = true;
    if (this.child) await this.terminate(this.child);
  }
}

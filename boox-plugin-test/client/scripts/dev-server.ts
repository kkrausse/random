// Throwaway OpenCode v2 server wired to the mock provider. Everything lives under one scratch
// directory with its own XDG homes, so it never sees the user's real OpenCode data, service, or
// provider credentials, and the only enabled provider is the local fake.
//
//   bun run scripts/dev-server.ts            # start and keep running, prints URL and password
//   SCRATCH=/some/dir PORT=41555 bun run scripts/dev-server.ts

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { startMockProvider } from "./mock-provider";
import type { MockProvider } from "./mock-provider";

export interface DevServer {
  baseUrl: string;
  password: string;
  directory: string;
  scratch: string;
  provider: MockProvider;
  log: () => string;
  stop: () => Promise<void>;
}

export interface DevServerOptions {
  scratch?: string;
  port?: number;
  /** Extra top-level config merged over the reading-server policy. */
  config?: Record<string, unknown>;
  /** Extra arguments for `opencode serve`, e.g. ["--cors", "http://127.0.0.1:1234"]. */
  serveArgs?: string[];
}

export const MOCK_MODEL = { providerID: "mock", id: "mock-1" };

export async function startDevServer(options: DevServerOptions = {}): Promise<DevServer> {
  const scratch = resolve(options.scratch || process.env.SCRATCH
    || join(import.meta.dir, "..", ".scratch", `run-${process.pid}`));
  const port = options.port || Number(process.env.PORT || 0) || 41500 + Math.floor(Math.random() * 400);
  const password = "mock-password";
  rmSync(scratch, { recursive: true, force: true });
  const deploy = join(scratch, "deploy");
  const directory = join(deploy, "workdir");
  for (const name of ["data", "config", "state", "cache", "home"]) {
    mkdirSync(join(scratch, name), { recursive: true });
  }
  mkdirSync(directory, { recursive: true });

  // Same layout as the Pi: the checked-in policy and instructions sit in the parent of workdir.
  const runtime = join(import.meta.dir, "..", "..", "server", "runtime");
  const policy = JSON.parse(await Bun.file(join(runtime, "opencode.json")).text());
  if (existsSync(join(runtime, "AGENTS.md"))) cpSync(join(runtime, "AGENTS.md"), join(deploy, "AGENTS.md"));

  const provider = startMockProvider();
  writeFileSync(join(deploy, "opencode.json"), JSON.stringify({
    ...policy,
    autoupdate: false,
    share: "disabled",
    enabled_providers: ["mock"],
    model: "mock/mock-1",
    small_model: "mock/mock-1",
    provider: {
      mock: {
        npm: "@ai-sdk/openai-compatible",
        name: "Mock",
        options: { baseURL: provider.url, apiKey: "mock-key" },
        models: {
          "mock-1": {
            name: "Mock One",
            tool_call: true,
            reasoning: true,
            limit: { context: 100000, output: 8000 },
            cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 1.25 },
            variants: { low: {}, high: {} }
          },
          "mock-2": { name: "Mock Two", tool_call: true, limit: { context: 100000, output: 8000 } }
        }
      }
    },
    ...(options.config || {})
  }, null, 2));

  const logPath = join(scratch, "serve.log");
  const logFile = Bun.file(logPath);
  const child = Bun.spawn([
    process.env.OPENCODE_BIN || "opencode", "serve", "--hostname", "127.0.0.1", "--port", String(port),
    ...(options.serveArgs || [])
  ], {
    cwd: directory,
    // A minimal environment: no provider API keys or OpenCode settings leak in from the shell.
    env: {
      PATH: process.env.PATH || "",
      HOME: join(scratch, "home"),
      XDG_DATA_HOME: join(scratch, "data"),
      XDG_CONFIG_HOME: join(scratch, "config"),
      XDG_STATE_HOME: join(scratch, "state"),
      XDG_CACHE_HOME: join(scratch, "cache"),
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_MODELS_FETCH: "1",
      // Belt and braces: anything that is not loopback goes to a dead proxy, so a misconfigured
      // run cannot reach a real provider (the bundled catalog lists free hosted models).
      HTTP_PROXY: "http://127.0.0.1:9",
      HTTPS_PROXY: "http://127.0.0.1:9",
      NO_PROXY: "127.0.0.1,localhost"
    },
    stdout: logFile,
    stderr: logFile
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const authorization = `Basic ${btoa(`opencode:${password}`)}`;
  const stop = async () => {
    child.kill();
    await child.exited;
    provider.stop();
  };
  const log = () => existsSync(logPath) ? require("node:fs").readFileSync(logPath, "utf8") as string : "";
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/api/info`, { headers: { Authorization: authorization } });
      if (response.ok) return { baseUrl, password, directory, scratch, provider, log, stop };
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  await stop();
  throw new Error(`OpenCode dev server did not start:\n${log()}`);
}

if (import.meta.main) {
  const server = await startDevServer();
  console.log(JSON.stringify({
    baseUrl: server.baseUrl, password: server.password, directory: server.directory,
    scratch: server.scratch, mockProvider: server.provider.url, pid: process.pid
  }, null, 2));
  const shutdown = () => void server.stop().then(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Local stub of the planned F2 OpenCode server/client surface.
//
// Intended real imports (not yet implemented — workspace-api F1/C2/D2):
//   `import { Runtime } from "workspace-api";`
//   OpenCode bundle entry served via `runtime.node({ entry: <pinned opencode serve entry> })`
//   plus `runtime.expose(port)` endpoint fetch adapter and the pinned OpenCode
//   HTTP client/event-stream against that endpoint.
//
// Until those land, every function below throws/rejects `not implemented` so the
// demo typechecks and documents intended wiring without fabricating success.
// `src/main.ts` imports ONLY from this stub — never from kernel bridge globals,
// `window.demo`, or sibling `node_modules`/`.runtime` paths.

export interface NodeLaunchOptions {
  entry: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export interface ExecutionHandle {
  stop(): Promise<void>;
}

export interface Runtime {
  node(options: NodeLaunchOptions): Promise<ExecutionHandle>;
  expose(port: number, options?: { signal?: AbortSignal }): Promise<EndpointHandle>;
  stop(): Promise<void>;
}

export interface EndpointHandle {
  readonly url: string;
  readonly port: number;
  fetch(input: string, init?: RequestInit): Promise<Response>;
  close(): void;
}

export interface OpenCodeServerOptions {
  /** Workspace root the server operates on (e.g. "/workspace"). */
  projectRoot?: string;
  /** Guest port the OpenCode service listens on. Default 4106. */
  port?: number;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export interface OpenCodeServer {
  readonly endpoint: EndpointHandle;
  stop(): Promise<void>;
}

export interface SessionInfo {
  id: string;
  title?: string;
}

export type ChatEvent =
  | { type: "text"; sessionID: string; delta: string }
  | { type: "done"; sessionID: string }
  | { type: "error"; sessionID: string; message: string };

export type ChatUnsubscribe = () => void;

function notImplemented(name: string): never {
  throw new Error(`[opencode-client-demo stub] ${name} not implemented`);
}

export const Runtime = {
  start(_options: unknown): Promise<Runtime> {
    return Promise.reject(notImplemented("Runtime.start"));
  },
};

/** Launch the pinned OpenCode server bundle as an ordinary app via Runtime. */
export async function startServer(
  _runtime: Runtime,
  _options?: OpenCodeServerOptions,
): Promise<OpenCodeServer> {
  return Promise.reject(notImplemented("startServer"));
}

/** Generic endpoint health probe (listening check, not app-health parsing). */
export async function checkEndpointHealth(
  _endpoint: EndpointHandle,
  _signal?: AbortSignal,
): Promise<void> {
  return Promise.reject(notImplemented("checkEndpointHealth"));
}

/** Typed chat client over the endpoint fetch adapter. */
export class SessionClient {
  constructor(_endpoint: EndpointHandle) {
    notImplemented("SessionClient.constructor");
  }
  list(_signal?: AbortSignal): Promise<SessionInfo[]> {
    return Promise.reject(notImplemented("SessionClient.list"));
  }
  create(_options?: { title?: string }): Promise<SessionInfo> {
    return Promise.reject(notImplemented("SessionClient.create"));
  }
  send(
    _sessionID: string,
    _prompt: string,
    _signal?: AbortSignal,
  ): Promise<void> {
    return Promise.reject(notImplemented("SessionClient.send"));
  }
  abort(_sessionID: string): Promise<void> {
    return Promise.reject(notImplemented("SessionClient.abort"));
  }
  subscribe(
    _sessionID: string,
    _onEvent: (event: ChatEvent) => void,
  ): ChatUnsubscribe {
    return notImplemented("SessionClient.subscribe");
  }
}

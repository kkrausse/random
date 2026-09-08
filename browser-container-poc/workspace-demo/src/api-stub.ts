// Local stub of the planned `workspace-api` public surface (api-plan.md).
// Every method throws `not implemented` — this documents intended wiring
// without fabricating backend success. Wire-up: replace this import with
// the real `workspace-api` package (task F1 dependency) once it lands.

export interface WorkspaceFs {
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  readFile(path: string): Promise<string>;
}

export interface RipgrepMatch {
  file: string;
  line: number;
  text: string;
}

export interface ExecutionHandle {
  readonly stdout: AsyncIterable<Uint8Array>;
  readonly stderr: AsyncIterable<Uint8Array>;
  readonly exited: Promise<{ code: number | null; forced: boolean }>;
  stop(): Promise<void>;
}

export interface EndpointHandle {
  readonly url: string;
  readonly port: number;
  close(): void;
}

export interface PreviewAttachment {
  dispose(): void;
}

export interface Workspace {
  readonly fs: WorkspaceFs;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export interface Runtime {
  readonly tools: {
    ripgrep(options: {
      pattern: string;
      paths: string[];
      signal?: AbortSignal;
    }): Promise<RipgrepMatch[]>;
  };
  node(options: {
    entry: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    signal?: AbortSignal;
  }): Promise<ExecutionHandle>;
  expose(port: number, options?: { signal?: AbortSignal }): Promise<EndpointHandle>;
  stop(): Promise<void>;
}

function notImplemented(name: string): never {
  throw new Error(`[workspace-api stub] ${name} not implemented`);
}

export const Workspace = {
  open(_options: { id: string; storage?: unknown }): Promise<Workspace> {
    return Promise.reject(notImplemented("Workspace.open"));
  },
};

export const Runtime = {
  start(_options: unknown): Promise<Runtime> {
    return Promise.reject(notImplemented("Runtime.start"));
  },
};

export function attachPreview(
  _iframe: HTMLIFrameElement,
  _endpoint: EndpointHandle,
): PreviewAttachment {
  return notImplemented("attachPreview");
}

export async function consumeOutput(
  _stdout: AsyncIterable<Uint8Array>,
  _stderr: AsyncIterable<Uint8Array>,
  _onChunk: (stream: "stdout" | "stderr", bytes: Uint8Array) => void,
): Promise<void> {
  return notImplemented("consumeOutput");
}

// A0 public type skeleton. Proposed API only — no backend wired yet.
// See MAPPING.md for the backend-gap analysis.

export type WorkspaceId = string;

/** Opaque storage descriptor supplied by the consumer (e.g. OPFS store). */
export interface WorkspaceStorage {
  readonly kind: string;
}

export interface WorkspaceOpenOptions {
  id: WorkspaceId;
  storage: WorkspaceStorage;
}

/** Minimal filesystem surface (subset of plan §Workspace). */
export interface WorkspaceFs {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  stat(path: string): Promise<{ isDirectory: boolean; isFile: boolean; size: number }>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Subscribe to change events; returns unsubscribe. */
  watch(listener: (event: { paths: string[] }) => void): () => void;
}

export type PersistenceState =
  | { status: "opening" }
  | { status: "durable" }
  | { status: "ephemeral"; reason: string }
  | { status: "failed"; error: string };

export interface Distribution {
  /** Identity of the runtime build consumed (worker/WASM/SW asset set). */
  readonly name: string;
  readonly version: string;
  /** Base URL the consumer resolves worker/WASM/SW assets from. */
  readonly assetBaseUrl: string;
}

/** A statically configured tool descriptor supplied to Runtime.start. */
export interface ToolDescriptor<TOptions, TResult> {
  readonly name: string;
  readonly version: string;
  /** Typed invocation bound to the configured implementation. */
  invoke(options: TOptions): Promise<TResult>;
}

export interface NodeLaunchOptions {
  entry: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export interface Execution {
  readonly stdout: AsyncIterable<Uint8Array>;
  readonly stderr: AsyncIterable<Uint8Array>;
  readonly exited: Promise<{ exitCode: number }>;
  stop(): Promise<void>;
}

export interface Endpoint {
  readonly url: string;
  readonly port: number;
  fetch(input: string, init?: RequestInit): Promise<Response>;
  dispose(): void;
}

export type ErrorCode =
  | "ENTRY_NOT_FOUND"
  | "LAUNCH_REJECTED"
  | "BACKEND_UNAVAILABLE";

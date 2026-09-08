import type {
  Distribution,
  Endpoint,
  Execution,
  NodeLaunchOptions,
  ToolDescriptor,
} from "./types.js";
import { BackendUnavailableError } from "./workspace.js";
import type { Workspace } from "./workspace.js";

/**
 * Runtime bound to a fixed tool set TTools. Tool methods are inferred from the
 * `tools` argument to Runtime.start — no string-based callTool API.
 */
export interface Runtime<
  TTools extends Record<string, ToolDescriptor<any, any>> = Record<string, ToolDescriptor<any, any>>,
> {
  readonly tools: { [K in keyof TTools]: TTools[K] };
  node(options: NodeLaunchOptions): Promise<Execution>;
  /** Browser-facing routing for a guest listener. No access-type enum. */
  expose(port: number, options?: { signal?: AbortSignal }): Promise<Endpoint>;
  stop(): Promise<void>;
}

export interface RuntimeStartOptions<TTools extends Record<string, ToolDescriptor<any, any>>> {
  distribution: Distribution;
  workspace: Workspace;
  tools: TTools;
}

/** Explicit execution machinery attached to a workspace. A0: start rejects. */
export namespace Runtime {
  export async function start<TTools extends Record<string, ToolDescriptor<any, any>>>(
    _options: RuntimeStartOptions<TTools>,
  ): Promise<Runtime<TTools>> {
    throw new BackendUnavailableError("Runtime.start");
  }
}

import type {
  PersistenceState,
  WorkspaceFs,
  WorkspaceId,
  WorkspaceOpenOptions,
} from "./types.js";

/** Error thrown when a call needs backend support that A0 does not wire up. */
export class BackendUnavailableError extends Error {
  readonly code = "BACKEND_UNAVAILABLE" as const;
  constructor(what: string) {
    super(`${what} has no backend in workspace-api A0 (see MAPPING.md)`);
    this.name = "BackendUnavailableError";
  }
}

/** Filesystem-only workspace handle (plan §Workspace). */
export interface Workspace {
  readonly id: WorkspaceId;
  readonly fs: WorkspaceFs;
  readonly persistence: PersistenceState;
  /** Durability barrier for preceding accepted writes. Not an atomic checkpoint. */
  flush(): Promise<void>;
  /** Releases storage resources. Rejects while a runtime is attached (proposed). */
  close(): Promise<void>;
}

/** Filesystem-only workspace handle. A0: opening rejects; no storage wired. */
export namespace Workspace {
  export async function open(_options: WorkspaceOpenOptions): Promise<Workspace> {
    throw new BackendUnavailableError("Workspace.open");
  }
}

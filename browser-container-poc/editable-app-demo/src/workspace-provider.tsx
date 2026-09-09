import type { ReactNode } from "react";
import { WorkspaceProvider as PackageProvider, type ControllerDiagnosticEvent } from "@kev-browser-agent-kit/workspace/react";
import { diagnostics } from "./diagnostics";

export { WorkspaceController, useWorkspace } from "@kev-browser-agent-kit/workspace/react";
export type { Connection, Service, Progress, WorkspaceSnapshot } from "@kev-browser-agent-kit/workspace/react";

/** Demo-specific local collection stays outside the reusable package. */
export function recordControllerDiagnostic(event: ControllerDiagnosticEvent) {
  if (event.event === "operation.start") diagnostics.begin();
  diagnostics.record(event.event, { controllerRunId: event.runId, detail: event.data });
  if (event.event === "operation.end") void diagnostics.flush();
}
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  return <PackageProvider onDiagnostic={recordControllerDiagnostic}>{children}</PackageProvider>;
}

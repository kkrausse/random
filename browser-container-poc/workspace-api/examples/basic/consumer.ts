import { Runtime, Workspace } from "../../src/index.js";
import type { RipgrepTool } from "../../src/index.js";

// Small intended-usage consumer (api-plan.md §Proposed usage, trimmed to A0).
// Must typecheck; every call rejects with BackendUnavailableError until A1+.

export async function runBasic(opts: {
  workspaceId: string;
  distribution: { name: string; version: string; assetBaseUrl: string };
  ripgrep: RipgrepTool;
}) {
  const workspace = await Workspace.open({
    id: opts.workspaceId,
    storage: { kind: "opfs" },
  });
  await workspace.fs.writeFile("/src/App.tsx", "export default {}");
  const runtime = await Runtime.start({
    distribution: opts.distribution,
    workspace,
    tools: { ripgrep: opts.ripgrep },
  });
  const matches = await runtime.tools.ripgrep.invoke({
    pattern: "TODO",
    paths: ["/workspace/src"],
  });
  const vite = await runtime.node({
    entry: "/workspace/node_modules/vite/bin/vite.js",
    args: ["--port", "5173", "--strictPort"],
    cwd: "/workspace",
    env: {},
  });
  const endpoint = await runtime.expose(5173);
  void matches;
  await vite.stop();
  endpoint.dispose();
  await runtime.stop();
  await workspace.flush();
  await workspace.close();
}

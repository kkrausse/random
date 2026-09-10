/** Fail before startup/bundling with actionable public-package preparation. */
export async function checkLocalPackages() {
  for (const specifier of ["@kev-browser-agent-kit/workspace", "@kev-browser-agent-kit/workspace/react", "@kev-browser-agent-kit/workspace/server", "@kev-browser-agent-kit/opencode-chat", "@kev-browser-agent-kit/opencode-chat/editor", "@kev-browser-agent-kit/opencode-chat/editor.css", "@kev-browser-agent-kit/opencode-chat/styles.css"]) {
    try {
      if (await Bun.file(new URL(import.meta.resolve(specifier))).exists()) continue;
    } catch { /* Missing install or unbuilt file dependency. */ }
    throw Error(`Missing built public export ${specifier}. From editable-app-demo run: (cd ../workspace-api && bun install --ignore-scripts && bun run build) && (cd ../opencode-chat && bun install --ignore-scripts && bun run build) && bun install --ignore-scripts. Then rerun bun run demo. These are package builds, not a runtime rebuild.`);
  }
}

/** Fail before startup/bundling with actionable public-package preparation. */
export async function checkLocalPackages() {
  for (const specifier of ["@vivari/workspace-api", "@vivari/workspace-api/react", "@vivari/workspace-api/server", "@vivari/opencode-chat", "@vivari/opencode-chat/react", "@vivari/opencode-chat/styles.css"]) {
    try {
      if (await Bun.file(new URL(import.meta.resolve(specifier))).exists()) continue;
    } catch { /* Missing install or unbuilt file dependency. */ }
    throw Error(`Missing built public export ${specifier}. From workspace-demo run: (cd ../workspace-api && bun install --ignore-scripts && bun run build) && (cd ../opencode-chat && bun install --ignore-scripts && bun run build) && bun install --ignore-scripts. Then rerun bun run demo. These are package builds, not a runtime rebuild.`);
  }
}

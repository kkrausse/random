# Tagged V2 build attempt — September 11, 2026

Candidate: upstream release `v1.18.30` (published September 9), exact tag commit
`3104c1428ec91f809e5ab86631300de41eb6952e`. This selects the V2 source included
in that release tree; it does not qualify the release's downloadable binaries as V2.

Isolated experiment:
`/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode/tagged-v2.tt0ngH`.

- Clean detached upstream worktree under `.runtime/opencode-v2-source`.
- `bun install --frozen-lockfile --ignore-scripts` passed with Bun 1.4.0;
  2,335 packages installed. Upstream declares Bun 1.3.14. Install scripts were
  skipped, so this is not full installation qualification. Source status remained clean.
- Copied the existing minimal Bun Node-target recipe unchanged. The invocation
  entry imports upstream `packages/cli/src/index.ts`, because this tag has no
  `ServerProcess` entry or CLI package exports matching the accepted build.
- One `bun run build.ts` attempt failed. The bundler traversed the dynamically
  imported TUI branch and rejected imports from `bun` in
  `packages/tui/src/component/dialog-status.tsx` (`fileURLToPath`) and
  `packages/tui/src/component/prompt/autocomplete.tsx` (`pathToFileURL`).
  Full diagnostics: experiment `build.log`. Bun describes these as a “Browser
  build” error even though the recipe explicitly selects `target: 'node'`.
- No source rewrites, externalization workaround, runtime changes, browser
  execution, or model requests. No candidate server bundle or startup PASS.

Next bounded investigation: determine whether this tag's existing `serve` handler
can be invoked using its upstream command framework without including the TUI
entry. Establish that from source before changing the launcher. Do not rewrite
the offending imports or stub out the TUI to make the bundle pass.

The accepted artifacts and shared qualified pins remain unchanged.

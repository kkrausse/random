# Commit Diff Viewer Plugin Plan

## Goal

Add `/commit-diff` to the normally installed OpenCode V2 CLI. The command selects a Git revision and opens the bundled diff viewer for `<revision>..HEAD`, excluding working-tree changes.

Do not copy the diff viewer, parse Git diff output, create temporary branches, or require a custom OpenCode build.

## Verified OpenCode Support

The installed `opencode2 v0.0.0-beta-18707` server exposes:

```ts
client.vcs.diff({
  location,
  mode: "committed",
  base: revision,
  context: 12,
})
```

`base` accepts branch names, revision expressions such as `HEAD~1`, and full commit SHAs. This was verified against the running server. The server performs repository access, merge-base resolution, diff parsing, normalization, and output limiting, so it also works when the TUI and server do not share a filesystem.

The bundled viewer already supports three sources:

- `working`: `HEAD` to the working copy.
- `branch`: the selected base merge-base to the working copy.
- `committed`: the selected base merge-base to `HEAD`.

## POC Approach

Create a CLI-only plugin with no server component.

1. Register `/commit-diff` and `commit-diff.open`.
2. Show a searchable picker containing the 25 most recent commits before HEAD, with their subjects, authors, and relative dates. Keep manual SHA/revision entry as the final option and as the fallback when local history is unavailable.
3. Navigate to the bundled `diff` route in `committed` mode.
4. While that route contains the plugin marker, wrap `context.client.vcs.base` so the viewer labels the selected revision correctly.
5. Wrap `context.client.vcs.diff` so the bundled viewer requests `mode: "committed"` with the selected revision as `base`.
6. Delegate all calls outside the marked route unchanged and restore both methods when the plugin unloads.

This reuses the bundled viewer's file tree, patches, syntax highlighting, navigation, reviewed state, image behavior, byte limits, and future UI improvements.

## POC Structure

```text
opencode-plugin-commit-diff-viewer/
  package.json
  tsconfig.json
  tui.ts
  src/
    tui.ts
  plan.md
```

Expose the CLI plugin through the package's `./tui` entrypoint and load it from `cli.json`:

```json
{
  "plugins": [
    "/absolute/path/to/opencode-plugin-commit-diff-viewer/tui.ts"
  ]
}
```

Configure the exact entrypoint file for a local checkout. OpenCode imports file targets directly; a directory target may be treated as a discovered plugin directory and resolved by appending `/tui`. Preserve unrelated CLI settings when installing it.

## POC Limitations

- The bundled route does not publicly accept a base revision, so mutating the generated client's `base` and `diff` methods is an unsupported compatibility shim.
- An explicit base selected in the bundled viewer's private in-memory storage controls its displayed label. The wrapped diff call still enforces the requested revision, so choosing a base inside the marked viewer can make its label misleading until the TUI exits. Removing this limitation requires the bundled route to accept an explicit base.
- OpenCode does not currently expose commit-history enumeration. The searchable picker therefore runs local `git log` in the CLI's location and falls back to manual revision entry if that repository is unavailable locally (for example, when connected to a remote server).
- The package is pinned to the installed beta because the V2 CLI plugin API is changing.

## Verification

Automated:

- Typecheck against the pinned `@opencode-ai/plugin` version.
- Confirm ordinary VCS calls delegate unchanged outside the marked route.
- Confirm marked diff requests force `mode: "committed"` and the selected `base`.

Manual:

1. Open `/commit-diff` from home and from a session.
2. Test a full SHA, abbreviated SHA, and `HEAD~N`.
3. Confirm the displayed files match `git diff --name-only <revision>..HEAD`.
4. Confirm uncommitted changes are excluded.
5. Confirm closing returns to the originating route.
6. Confirm ordinary `/diff` behavior is unchanged afterward.
7. Test after choosing a base manually in the bundled viewer.
8. Test against a remote OpenCode server.

Terminal-control verification against `opencode2 v0.0.0-beta-18999` confirmed items 1–6 with `HEAD~1`, an abbreviated SHA, and a full SHA. It also confirmed the private base-selection limitation described above. Remote-server testing remains outstanding.

## Next Step After POC

If OpenCode exposes commit enumeration through its VCS API, replace the local `git log` picker with that API so commit history also works against remote servers.

The ideal upstream API is for the bundled diff route to accept `mode` and `base` directly. That would remove both wrappers and reduce the plugin to a prompt plus navigation.

## Success Criteria

- `/commit-diff` offers recent commits with their messages, accepts a manually entered revision, and opens the bundled viewer.
- The comparison is the selected revision through `HEAD`.
- Working-tree changes remain excluded.
- No Git diff parsing or custom diff rendering exists in the plugin.
- No additional server plugin or custom OpenCode build is required.
- Removing the CLI plugin restores the unmodified experience.

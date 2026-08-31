# Commit Diff Viewer Plugin Plan

## Goal

Create a local OpenCode V2 CLI plugin that keeps the system diff viewer experience but adds a commit picker for comparing the current checkout against an earlier commit. The plugin will register a separate `/commit-diff` command and run inside the normally installed `opencode2`; it will not require a custom OpenCode build.

## Approach

Use the OpenCode repository as the reference source and initial dependency workspace. Start from the bundled system diff viewer, preserve its UI and file-tree behavior, and replace only the private host-context imports that cannot work from an externally loaded plugin.

Do not override the built-in `/diff` command initially. Register a distinct route and command so the custom viewer can coexist with the system viewer and remain easy to disable.

## Reference Source

Copy or adapt these files from the matching OpenCode revision:

- `packages/tui/src/feature-plugins/system/diff-viewer.tsx`
- `packages/tui/src/feature-plugins/system/diff-viewer-ui.tsx`
- `packages/tui/src/feature-plugins/system/diff-viewer-file-tree.tsx`
- `packages/tui/src/feature-plugins/system/diff-viewer-file-tree-utils.ts`
- Relevant diff viewer tests under `packages/tui/test/`

Record the OpenCode commit used as the source baseline so later upstream changes can be compared and selectively incorporated.

## Public Plugin Adaptation

Use `@opencode-ai/plugin/tui` as the supported interface to the running TUI.

Replace private context-dependent imports with values or components supplied by the plugin API:

- Replace the internal theme hook with `api.theme` values passed through component props.
- Replace internal keymap hooks with `api.keymap`, `api.keys`, and `api.tuiConfig.keybinds`.
- Replace the internal select dialog with `api.ui.DialogSelect` and `api.ui.dialog`.
- Remove indirect imports that create duplicate theme or keymap contexts.

Keep pure relative helpers temporarily where they do not rely on host context. Copy small helpers into the plugin when doing so makes the plugin independent of private OpenCode source paths. Likely examples include filetype lookup, text truncation, color tinting, and scroll configuration.

## Plugin Structure

Create a standalone package with approximately this layout:

```text
opencode-plugin-commit-diff-viewer/
  package.json
  src/
    tui.tsx
    diff-viewer.tsx
    diff-viewer-ui.tsx
    diff-viewer-file-tree.tsx
    diff-viewer-file-tree-utils.ts
  test/
  plan.md
```

Export the CLI plugin through the package's `./tui` entrypoint and use the OpenTUI and Solid packages as peer dependencies where required by OpenCode's plugin documentation.

## Command And Route

Register names that do not collide with the system plugin:

- Plugin ID: `commit-diff-viewer`
- Route: `commit-diff`
- Command ID: `commit-diff.open`
- Slash command: `/commit-diff`

The route should retain the current route as its return destination so closing the viewer returns to the correct session or home screen.

## Commit Selection

When `/commit-diff` opens:

1. Resolve the active repository and current branch from the plugin context.
2. Load a bounded list of commits reachable from the current branch.
3. Show a searchable picker containing abbreviated SHA, subject, author, and relative or absolute date.
4. Default to a useful recent commit without silently selecting it.
5. Load the diff from the selected commit to the current `HEAD`.
6. Preserve the selected commit while the viewer remains open and support changing it from inside the viewer.

The initial implementation should compare `<selected-commit>..HEAD`. Working-tree changes should remain excluded unless a later explicit scope option is added.

## Git Integration

Prefer OpenCode's public VCS/client API if it supports arbitrary revision comparisons by implementation time. If it only supports predefined working or branch modes, run read-only Git commands from the local CLI plugin using the repository directory supplied by the plugin context.

Required Git operations:

- Enumerate commits with machine-parseable delimiters.
- Resolve and validate the selected revision.
- Produce file status and unified patches for `<selected-commit>..HEAD`.
- Handle renamed, added, modified, deleted, binary, and empty files.

Do not create temporary branches or mutate repository state.

## Diff Data

Normalize Git output into the same shape expected by the copied viewer:

```ts
type DiffFile = {
  file: string
  patch?: string
  additions: number
  deletions: number
  status: "added" | "deleted" | "modified"
}
```

Keep parsing separate from rendering so Git behavior can be tested without starting the TUI.

## Configuration

Load the finished local plugin from `~/.config/opencode/cli.json` using its absolute package directory:

```json
{
  "plugins": [
    "/absolute/path/to/opencode-plugin-commit-diff-viewer"
  ]
}
```

Preserve all unrelated CLI settings when installing it.

## Testing

Add focused tests for:

- Commit log parsing.
- Revision validation.
- Diff and numstat parsing.
- Added, modified, deleted, renamed, and binary files.
- Empty repositories and repositories with only one commit.
- File-tree behavior retained from the system plugin.
- Route registration and the `/commit-diff` command.
- Closing the viewer returns to the originating route.

Manually verify the plugin in repositories where the current branch is `main`, a feature branch, detached `HEAD`, and a repository with uncommitted changes.

## Implementation Order

1. Clone or fetch the OpenCode source revision matching the installed `opencode2` version.
2. Create the standalone plugin package and copy the diff viewer source plus tests.
3. Rename the plugin, route, and commands to avoid collisions.
4. Replace private context-dependent imports with public plugin APIs.
5. Confirm the copied viewer loads with a fixed test diff.
6. Implement commit enumeration and selection.
7. Implement arbitrary commit-to-`HEAD` diff loading and normalization.
8. Add error, empty-state, refresh, and commit-switching behavior.
9. Run unit tests and typechecking.
10. Add the local package to `cli.json` and verify it in the installed `opencode2`.

## Success Criteria

- `/commit-diff` opens from the normally installed OpenCode V2 client.
- The user can choose a prior commit on `main` and compare it with current `main`.
- The viewer retains the system viewer's file tree, patch layout, syntax highlighting, navigation, and reviewed-file state where practical.
- The plugin does not override `/diff`, mutate Git state, or require rebuilding OpenCode.
- Removing the plugin entry from `cli.json` cleanly restores the unmodified OpenCode experience.

## Risks

- The public CLI plugin API is beta and may change between OpenCode releases.
- Some system viewer behavior may depend on private helpers with no exact public equivalent.
- Loading source copied from a different OpenCode revision may cause type or runtime incompatibilities.
- Git diff parsing must account for filenames containing unusual characters and for binary patches.

Mitigate these risks by pinning the source revision, minimizing copied private code, testing parser behavior independently, and keeping the custom command separate from the system viewer.

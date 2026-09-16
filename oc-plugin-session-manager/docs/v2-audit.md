# OpenCode V2 compatibility audit

Audited 2026-09-15 against released OpenCode **2.0.3**, its running-server
OpenAPI contract, and the matching `@opencode/plugin` / `@opencode/client`
packages. Both the installed terminal and `/api/health` reported 2.0.3.

## Verdict

**Current picker update:** `x` now uses history-preserving soft archival from
`src/soft-archive.ts`. The export/delete function audited below is deprecated and
retained for recovery/testing; existing local archives still restore normally.
Soft archival resolves the full ancestry, recursively stops descendants, removes
owned shells, drains durable inboxes, and requires two clean verification sweeps.
Only the parent receives a UI marker. See the README for current behavior and
`bun run verify:soft-archive` for its separate real-server check. The findings and
limitations below describe the older export/delete implementation.

The core picker and parent-transcript archive/restore flow work with V2.0.3
after the fixes in this audit. This is a version-specific compatibility result,
not a guarantee for future API releases or a lossless session-family backup.

The plugin already used the V2-style `Plugin.define` lifecycle, connected
Promise client, reactive keymaps, slots, storage, and events. Its dependency
namespace and pinned version still targeted an earlier V2 beta.

## Findings fixed

| Priority | Finding | Resolution |
| --- | --- | --- |
| High | Restore ignored the archived working directory. A live test restored into the server's default directory. | Pass `location: transcript.info.location` explicitly to import; verify the directory in the real round trip. |
| High | Imports and dependency pins targeted `@opencode-ai/*` beta packages. | Use released `@opencode/*` 2.0.3 packages and declare the directly used client dependency. |
| Medium | Dismissing the picker cancelled its Effect boundary even though the underlying archive Promise continued. Later errors and lifecycle bookkeeping could be lost. | Detached lifecycle jobs finish and report failures after dialog disposal; reads remain cancellable. |
| Medium | A generic HTTP 404 was accepted as proof of deletion. | Require V2's typed `SessionNotFoundError`; proxy/routing failures remain errors. |
| Medium | The six-line desktop archive preview could leave no space for transcript text. | Allocate the larger detail preview to archives and assert that archived text is visible in the renderer test. |
| Medium | Attention refresh passed `workspaceID` where the location query expects `workspace`. | Explicitly translate the location reference to query parameters, matching inbox and shell cleanup. |
| Low | A question could overwrite a permission badge for the same session. | Keep permission precedence during request-list reconciliation. |
| Low | Repeated descendant pagination cursors could keep archive cleanup looping. | Detect repeated cursors and stop before export/deletion. |
| Medium | Child archives require an existing parent, but import failures did not explain the recovery order. | Check the parent first and explicitly instruct restoring it before the child. |

## Archive semantics

The current server contract exposes export/import and recursive delete; it does
not expose a public archive/unarchive endpoint. `time.archived` in session data
does not establish such an endpoint. This plugin implements a **local transcript
archive plus deletion**, rather than an OpenCode-native archive flag.

1. Interrupt the selected loaded root and discover/interrupt descendants.
2. Remove tracked shells owned by that family, scoped to their locations.
3. Interrupt again, export the root without sanitization, and durably save it.
4. Recursively delete the root, verify known family members are absent, and
   sweep owned shells again.
5. Import the root at its saved location, then move the local archive into
   `archives/restored/` as a backup.

Only the root's exported transcript and transferable metadata are retained.
**Descendant transcripts are deleted and cannot be restored from this archive.**
Pending work and processes are not restored. Archives live on the TUI machine
at `${XDG_DATA_HOME:-~/.local/share}/opencode/claude-sessions/archives/` and are
excluded from weekly usage totals and OpenCode's ordinary server-side search.

## Verification performed

- TypeScript check against released packages: passed.
- Full automated suite: **35 passed, 0 failed**. Covers grouping, selection,
  rendered desktop/mobile layouts, approvals, inbox failures, archive failures,
  cancellation, pricing, and paginated weekly usage.
- Real-server `bun run verify:v2`: passed. Exercises user/assistant/shell
  transcript export and import, parent/child deletion, owned-shell cleanup,
  preservation of an unrelated shell, restored ID and directory, empty restored
  inbox, retained archive handling, and rejection of an import over a live ID.
  It creates no model requests and uses only disposable sessions/local files.
- Actual 2.0.3 terminal: plugin loaded; picker opened from the empty prompt and
  command palette; live rows and running indicators displayed. Historical
  unavailable locations were reported inline without preventing the picker
  from loading. Test terminal stopped afterward.
- Existing archive corpus, read-only: **145 version-1 archives / 9,020 messages**.
  Every transcript decoded successfully through 2.0.3's `SessionTransfer.Data`
  schema; every archive had a directory. Existing archives were not imported,
  rewritten, or deleted. Schema validity does not prove that every old project
  directory/workspace still exists or that its external resources are available.
- Four existing bundles are child archives. All four parents are also archived,
  and none is currently live: restore those parent archives first. No missing
  parent bundle was found for these four children. Seven archives have fork
  metadata; none of the existing archives uses a workspace ID.

## Remaining limitations / follow-up work

- **Concurrent lifecycle operations:** the UI blocks overlap within one picker,
  but archive files have no cross-process transaction lock. Multiple TUIs, a
  reopened picker, or another client resuming a session can race the multi-call
  export/delete sequence. There is no server-side atomic archive transaction.
- **Parent resolution is based on loaded rows:** archiving a child whose parent
  is not loaded archives that child subtree. An archived child still requires
  its parent to exist when imported. Full API-based ancestry resolution would
  remove this dependency on paging.
- **Archive-store availability:** one malformed/unreadable JSON bundle fails the
  entire archive listing and disables lifecycle actions for that picker. Current
  bundles all passed validation; per-file error isolation is a useful follow-up.
- **Partial completion:** failures after deletion or after successful import can
  leave a saved archive alongside changed server state. Reopen the picker to
  reconcile; a remaining live row takes precedence once loaded. Retained files
  support recovery, but there is no persistent transaction journal.
- **Usage completeness:** sidebar family totals depend on the host's loaded
  family/message caches. Weekly usage deliberately excludes deleted/archived
  sessions and scans live session history; it is not a permanent billing ledger.
- **Unverified environments:** workspace-backed remote execution, process-crash
  recovery, concurrent writers, and externally resumed sessions were not tested
  end to end. The real-server fixture used a local directory and idle sessions
  with running tracked shells; active model/tool interruption is covered by
  the API contract and mocked failure tests, not a live paid model run.
- The renderer suite emits an existing `MaxListenersExceededWarning`; all
  assertions pass. Listener growth has not been established as a production
  plugin leak and deserves separate measurement if it appears in regular use.

## References

- https://opencode.ai/v2/docs/migrate-v1
- https://opencode.ai/v2/docs/build/plugins
- https://opencode.ai/v2/docs/build/plugins/cli
- https://opencode.ai/v2/docs/build/client
- Running service `/openapi.json` and generated 2.0.3 client/types.

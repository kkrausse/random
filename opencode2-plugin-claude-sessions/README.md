# Sessions viewer

Package/directory: `opencode2-plugin-claude-sessions` (kept for existing plugin configurations).

Adds Claude Code-style session navigation to the OpenCode V2 terminal UI:

- Press `Left` while the focused prompt is empty to open a status-aware session picker.
- Press `Left` while the prompt contains text to move the cursor normally.
- Press `Alt+S` to open the picker globally, including from permission and question prompts.
- Labeled sections with prominent dividers show **Active → Archived** (including legacy inactive markers).
- Click **Archive** or press `x` to stop the session family, archive the parent's transcript locally, and delete the live family. Click **Restore to active** or press `r` to import the parent without starting work. These actions keep the picker open.
- Cleanup interrupts every family member, including idle sessions. An unavailable location/runtime or failed cleanup stops archival before deletion and shows an error.
- After `x` or `r` succeeds, selection moves to the next row in the original section, or the previous row at the end of that section, while preserving the scroll offset. If the section had only one row, selection falls back to **New session**. Navigating while the request is pending keeps your newer selection.
- Archived parents appear under **Archived** with subdued titles, a message count, and a scrollable user/assistant transcript preview. `Enter` reminds you to restore with `r` before opening the session in OpenCode.
- Press `/` to filter loaded live sessions and all archived parents by title or directory; submit an empty filter to clear it.
- Legacy inactive markers remain readable. They still describe live sessions, so running/attention status takes precedence. Press `x` to archive one, or `r` to clear its old marker. Existing markers are not automatically converted into deleted sessions.
- Archiving a child acts on its highest loaded parent. Cleanup discovers descendants through the paginated API, including children outside the picker's loaded pages. Children are deleted but **not archived or restored**.
- Shell cleanup lists each family's locations, matches `shell.metadata.sessionID`, and calls `shell.remove`. OpenCode handles termination; the plugin does not implement signal escalation. This covers tracked owned shells, not arbitrary untracked processes.
- Status indicators match OpenCode V2 tabs: `!` for permissions, `?` for questions, and a Braille spinner for running sessions.
- Indicators use the active theme's semantic status colors.
- Active sessions prioritize needs input, then working, then ready, ordered by latest interaction within each status. Inactive sessions are ordered by latest interaction.
- Each session occupies one line with its title, status, and lifecycle button. The selected session's location, agent, and last-interaction time appear in the preview.
- The preview has a pinned **Archive / Restore** button. On phones, a compact touch footer adds **Open / New** and **Close**. Phone-sized terminals use nearly the full screen height.
- Below 70 columns, rows prioritize the title and short time; status icons remain, while text status and context usage move to the preview. The selected title wraps to two lines, section headers tighten, and approvals get a dedicated compact action row. During approvals, model/usage details give way to the request.
- The current session is selected initially; from Home, `New session` is selected.
- Use `Up`/`Down` to select, `Right` or `Enter` to open, and `Left` or `Escape` to close.
- Press `N` from the picker to start a new session.
- Click a row or use the arrow keys to preview it below the list without changing the session behind the dialog. Hovering does not change selection, so you can move the mouse to the taller preview and scroll long commands without switching requests.
- Pending permissions show the action, message, resources, and any metadata in a scrollable preview. Press `a` to approve **once**, `A` (shift) to always approve, or `d` to deny the displayed request. The picker stays open; multiple requests are handled one at a time, never as a bulk approval.
- Subagents appear beneath their parent in the same section with a small indent, with further nesting for descendants. Children whose parent is unloaded remain independently selectable until it loads. Parent previews still aggregate descendant requests for approval.
- Pending questions show their title and field details; open the session to answer them. Approval shortcuts do not answer or dismiss questions.
- Preview loading/errors disable permission actions, replies cannot overlap, and held-key repeat events are ignored. Errors appear as toasts and requests refresh after replying.
- Older sessions load as you scroll.
- The picker resizes with the terminal, including phone keyboard/rotation changes. Narrow or short terminals use a compact header and a smaller scrollable approval preview.
- Tap/click a row to preview, double-tap or press `→`/`Enter` to enter it. Approval previews have **Once**, **Always**, and **Deny** buttons floated right at the top of the preview alongside the existing keyboard shortcuts. On phones, the approval heading is just the request count, keeping all three buttons visible.
- In `bun-web-terminal`, use its **Keyboard** button to explicitly show/hide the phone keyboard. Taps select TUI controls without opening it, and swipes scroll without clicking.

## Archive storage and API sequence

Archives are local to the TUI machine, including when connected to a remote server:

```text
${XDG_DATA_HOME:-~/.local/share}/opencode/claude-sessions/archives/<sessionID>.json
```

Each versioned JSON bundle contains `archivedAt`, cleanup `familyIDs`, and the
parent's raw `{ info, messages }` export (`sanitize: false`). Files are written
with mode `0600`, synced, atomically renamed, and read back before deletion.
Back up this directory to preserve archived history. The picker reads it when opened;
OpenCode's normal session search does not include these files.

Archival uses the connected client's APIs:

1. `POST /api/session/{id}/interrupt?continue=false` for each family member;
   recursively discover children with `GET /api/session?parentID={id}` and pagination.
2. `GET /api/shell?location[directory]=…` (plus workspace when present), then
   `DELETE /api/shell/{id}` at the same location for matching owners; re-list to verify removal.
3. Interrupt the family again after shell completion notifications, then
   `GET /api/session/{parentID}/export?sanitize=false` and save the archive.
4. `DELETE /api/session/{parentID}` recursively deletes the family; verify each
   family member returns session-not-found. Sweep owned shells again to catch
   any created by late notifications before deletion completed.
5. Restore with `POST /api/session/import` using the saved `transcript` object.
   On success, move the archive into `archives/restored/` as a retained backup.

Only the parent transcript and metadata return. Pending inbox work, child sessions,
and processes do not return. Import does not submit a prompt. Failed deletion or
import retains the archive; errors are surfaced for manual retry. If deletion fails,
the remaining live row takes precedence when the picker next loads it.

## Effect execution and diagnostics

All asynchronous picker work runs through Effect: paging, preview/context loads,
attention refreshes, permission replies, interrupts, and lifecycle storage.
The installed TUI API provides a Promise-only connected client, so `src/effects.ts`
adapts that client with `Effect.tryPromise`, retaining the host's authentication
and remote-server connection. Cache synchronization and storage use the same
adapter. Pure grouping, selection, and Solid rendering remain ordinary functions.

Failures carry an operation name, session/request or directory context, and the
original cause. Action failures show contextual toasts (including HTTP status
when available); page and preview failures appear inline. All failures, including
background refresh failures and unexpected defects, are logged with the
`[claude.sessions]` prefix and Effect cause/trace information. Background refresh
failures retain the previous data. Archive and restore failures include the
selected session ID and the underlying API/filesystem error.

Closing the picker interrupts its Effect jobs; switching selection cancels obsolete
preview/context jobs. Read HTTP calls receive cancellation signals. Once started,
the archive/restore transaction continues independently of picker dismissal so
closing the dialog does not strand it between export and deletion. Host cache and
storage methods also have no cancellation API. Mutations are not automatically retried.

## Local setup

Install dependencies:

```sh
bun install
```

Add the plugin directory to `~/.config/opencode/cli.json`:

```json
{
  "plugins": ["/absolute/path/to/opencode2-plugin-claude-sessions"]
}
```

Restart the OpenCode TUI after changing the plugin configuration.

# Sessions viewer

Package/directory: `oc-plugin-session-manager`.

Targets the released **OpenCode 2.0.7** plugin/client API (`@opencode/*`).
See [the V2 compatibility audit](docs/v2-audit.md) for the original audit and compatibility updates.

Adds Claude Code-style session navigation to the OpenCode V2 terminal UI:

- The sidebar shows the current session's context/token breakdown and dollar equivalents. It does not scan other sessions or load descendant transcripts. The picker's selected-session usage preview remains available.

- Press `Left` while the focused prompt is empty to open a status-aware session picker.
- Press `Left` while the prompt contains text to move the cursor normally.
- Press `Alt+S` to open the picker globally, including from permission and question prompts.
- The picker opens as a vertically and horizontally centered, extra-large dialog. It can grow to 116 columns and 40 rows on laptops and wide terminals, while narrow screens use the full terminal width and height by extending through the host's one-cell dialog insets. **Close**, `Left`, or `Escape` dismisses it without leaving the originating session (or Home).
- Labeled sections with prominent dividers show **Active → Inactive** (including explicit archives and legacy inactive markers).
- With no explicit parent override, inactivity is **imputed at read time after seven days** since the newest `time.updated` in the loaded family. Recent descendants keep their parent active; loading more sessions recomputes the result. The current conversation's family, running families, and families needing input remain active. This default performs no cleanup and writes no marker or session timestamp.
- Click **Archive** or press `x` to **soft archive**: recursively stop the family, remove its tracked shells, cancel all pending durable inbox items, and verify inactivity. Parent and child transcripts stay in OpenCode. **Restore** / `r` sets an explicit active override on the parent without starting work, so an old conversation does not immediately fall back to inactive. These actions keep the picker open.
- Cleanup repeats the stop/shell/inbox sweep and requires two consecutive clean checks, with a short settling interval. It discovers late descendants and retries up to four sweeps. If cleanup fails or work keeps arriving, the picker reports the error rather than marking the family archived. Unreachable runtimes (including deleted directories) are errors in this stricter soft-archive flow.
- After `x` or `r` succeeds, selection moves to the next row in the original section, or the previous row at the end of that section, while preserving the scroll offset. If the section had only one row, selection falls back to **New session**. Navigating while the request is pending keeps your newer selection.
- Legacy local archive files appear under **Inactive** with an **Archived** status, subdued titles, a message count, and a scrollable user/assistant transcript preview. `Enter` reminds you to restore these with `r` before opening. Soft-archived and age-inactive sessions open their normal history directly. Age-inactive rows show **Inactive · 7d+**, and their preview explains that no cleanup was performed.
- Press `/` to filter loaded live sessions and all archived parents by title or directory; submit an empty filter to clear it.
- Existing inactive markers remain readable. Running/attention status takes precedence, so renewed activity remains visible. Press `x` to run cleanup again, or `r` to explicitly mark the family active.
- Archiving or restoring a child resolves its top-level parent through the API, including unloaded ancestors. Cleanup follows all paginated descendants. **Only the root owns the inactive marker**; old child markers are cleared for that family. Children inherit the parent's lifecycle section and remain nested under it.
- Shell cleanup lists each family's locations, matches `shell.metadata.sessionID`, and calls `shell.remove`. OpenCode handles termination; the plugin does not implement signal escalation. This covers tracked owned shells, not arbitrary untracked processes.
- Status indicators use a single-cell far-left gutter: `!` for permissions, `?` for questions, and a yellow Braille spinner for running sessions. There is no selection sidebar, so status changes do not shift session titles or consume extra horizontal space.
- Indicators use the active theme's semantic status colors.
- Status begins as **Checking status…** until verified. Missing runtime capabilities, failed refreshes, and malformed cache results show **Status unavailable** (`×`), rather than Ready/Inactive. Press `Ctrl+R` to retry status and preview reads without closing the picker.
- Within Active / Inactive, rows use recent activity captured when the picker opens. Live badges and timestamps update without reordering on assistant output or attention changes; archive/restore can still move a family between sections. The API exposes `time.updated`, not last-user-input time, so this is stable activity ordering rather than exact user-input ordering.
- Each session occupies one line with its title, status, and lifecycle button. The selected session's location, agent, and last-interaction time appear in the preview.
- The preview has a pinned **Archive / Restore** button. On phones, a compact touch footer adds **Open / New** and **Close**.
- The selected session's bottom preview shows both its current context-window usage and cumulative input, cache-read, cache-write, output, and reasoning tokens. Below 70 columns these labels compact to fit.
- Below 70 columns, rows prioritize the title and short time; status icons remain, while text status and context usage move to the preview. The selected title wraps to two lines and section headers tighten. During approvals, model/usage details give way to the request.
- The current session is selected initially; from Home, `New session` is selected.
- While **New session** is selected, the preview acts as a cross-session inbox: **Allow / Deny / Always** handles the first pending permission and advances without moving selection. It queries locations known from loaded, current, and discovered active/attention sessions, independently of the text filter. Requests can include unloaded children at those locations; their owners are fetched directly. This is a **known-location inbox**, not a complete global history scan. Permissions come first; pending questions are shown afterward with **Open** to answer in their session. **New** / `Enter` still starts a new session.
- Unavailable inbox locations are counted inline and logged; reachable locations remain actionable. Failed locations contribute no stale approval controls and are retried on the next request event or reopening.
- Use `Up`/`Down` to select, `Right` or `Enter` to open, and `Left` or `Escape` to close.
- Press `N` from the picker to start a new session.
- Click a row or use the arrow keys to preview it below the list before opening it. Hovering does not change selection, so you can move the mouse to the taller preview and scroll long commands without switching requests.
- Pending permissions show the action, message, resources, and any metadata in a scrollable preview. Press `a` to approve **once**, `A` (shift) to always approve, or `d` to deny the displayed request. The picker stays open; multiple requests are handled one at a time, never as a bulk approval.
- Subagents appear beneath their parent in the same section with a small indent, with further nesting for descendants. Children whose parent is unloaded remain independently selectable until it loads. Parent previews still aggregate descendant requests for approval.
- Pending questions show their title and field details; open the session to answer them. Approval shortcuts do not answer or dismiss questions.
- Preview loading/errors disable permission actions, replies cannot overlap, and held-key repeat events are ignored. Errors appear as toasts and requests refresh after replying.
- Opening requests one page of up to 100 recent sessions. Current and discovered active/attention sessions can also appear outside that page. Older pages load when keyboard or pointer selection approaches the end of the list; wheel scrolling alone does not request another page.
- Opening shows rows as soon as the first page arrives. Per-session status checks run top-down in displayed order, four at a time, prioritizing Active before Inactive; each badge fills in as its check finishes. Local archive/age markers determine sections while status is checking or unavailable; verified running/input status can still move a family to Active. Closing cancels reads, and reopening starts a fresh first page.
- The picker resizes with the terminal, including phone keyboard/rotation changes. Narrow or short terminals use a compact header and a smaller scrollable approval preview.
- Tap/click a row to preview, double-tap or press `→`/`Enter` to enter it. Approval previews show the action and request count above a scrollable request, with a pinned **Allow / Deny / Always** bar below. **Allow** approves once. Equal-width cells are fully clickable, with three-line tap targets on phones when height permits; short keyboard-open layouts use one line. The chosen action shows **Sending…** in place and all approval cells disable during reply/refresh. Refresh retains the current request layout until the next result arrives.
- In `bun-web-terminal`, use its **Keyboard** button to explicitly show/hide the phone keyboard. Taps select TUI controls without opening it, and swipes scroll without clicking.

## Sidebar usage estimates

The sidebar uses recorded response costs first, then the current provider's
model rates. When those rates are missing, it uses the matching `opencode`
model from OpenCode's synced model catalog, including cache pricing and context
tiers. This covers subscription-backed Sol and Astra without hardcoded prices
or generation requests to Zen. Prices reflect the server's current catalog,
not historical rates at the time of each response.

Fast variants match by their underlying `modelID` and use standard Zen rates
without a priority surcharge. **Zen equivalent ≈** describes token usage valued
at those rates, not subscription spending. Estimates using other provider or
manual rates are labeled **Estimated cost ≈**.

Add fallback rates for models without provider or Zen pricing by changing the plugin entry in
`~/.config/opencode/cli.json` from a string to an object:

```jsonc
{
  "package": "/path/to/oc-plugin-session-manager",
  "options": {
    "usageRates": {
      "provider/model": [
        {
          "input": 2,
          "output": 10,
          "cache": { "read": 0.2, "write": 2.5 }
        }
      ]
    }
  }
}
```

The estimate combines recorded costs with the estimates above. Explicit zero
catalog rates are respected as free. Responses lacking pricing are counted as unpriced instead of
silently presented as free. Cumulative "session processed" tokens count every
request and therefore include context read repeatedly across turns. All sidebar
statistics are scoped to the open session.

### Cross-session usage

The rolling seven-day sidebar and its automatic full-history scans have been
removed. The pure weekly-usage loader remains available for a future explicit,
on-demand query; no standalone command is registered yet.

## Archive storage and API sequence

### Soft archive (current picker behavior)

`src/soft-archive.ts` preserves the complete live family and uses the connected
2.0.7 client's APIs:

1. Resolve the root through the API.
2. Recursively enumerate paginated descendants, interrupting each member with
   `resume: false` before listing its children. Refresh locations on each sweep.
3. Remove tracked shells whose `metadata.sessionID` belongs to the family, at each family's location.
4. List and cancel every pending durable inbox item (user, synthetic, compaction, or move).
5. Interrupt again and drain inboxes again after completion notifications.
6. Wait briefly, rediscover descendants, and verify no family member is active,
   no owned shell remains, and every inbox is empty. Require two consecutive clean
   sweeps; fail after four sweeps if the family does not settle.
7. Persist only the root's `session-lifecycle.inactive` marker in TUI plugin storage.

The existing parent controls the UI section and child ordering. Its stored
`inactive` value is a three-way override: absent uses the imputed seven-day default,
`true` means explicitly inactive, and `false` means explicitly active. `r` sets
the parent's override to `false` and clears stale child markers. Opening a soft-archived session reads its
normal OpenCode history directly; no export/import is needed. These sessions
continue to appear in native history/search and weekly usage totals.

This is a best-effort cleanup, not a server-enforced execution lock: a different
client or a later producer can submit new work. The picker still surfaces running
or attention state over an inactive marker. Cleanup covers tracked owned shells,
not arbitrary untracked processes. The marker is written only after verification;
if marker storage fails, history stays intact and cleanup can be retried.

### Legacy export/delete archives

`archiveSession` in `src/archive.ts` is **deprecated** and no longer called by the
picker. It remains available for legacy verification/recovery. Existing files
still appear in the picker with transcript previews and can be restored with `r`.
They are not automatically imported or converted. Unlike soft archives, these
sessions must be imported before opening their history in OpenCode.

Legacy archives are local to the TUI machine, including when connected to a remote server:

```text
${XDG_DATA_HOME:-~/.local/share}/opencode/claude-sessions/archives/<sessionID>.json
```

Each versioned JSON bundle contains `archivedAt`, cleanup `familyIDs`, and the
parent's raw `{ info, messages }` export (`sanitize: false`). Files are written
with mode `0600`, synced, atomically renamed, and read back before deletion.
Back up this directory to preserve archived history. The picker reads it when opened;
OpenCode's normal session search does not include these files.

The deprecated export/delete flow uses the connected client's APIs:

1. `POST /api/session/{id}/interrupt?resume=false` for each family member;
   recursively discover children with `GET /api/session?parentID={id}` and pagination.
2. `GET /api/shell?location[directory]=…` (plus workspace when present), then
   `DELETE /api/shell/{id}` at the same location for matching owners; re-list to verify removal.
3. Interrupt the family again after shell completion notifications, then
   `GET /api/session/{parentID}/export?sanitize=false` and save the archive.
4. `DELETE /api/session/{parentID}` recursively deletes the family; verify each
   family member returns session-not-found. Sweep owned shells again to catch
   any created by late notifications before deletion completed.
5. Restore with `POST /api/session/import` using the saved `transcript` object
   and an explicit `location: transcript.info.location`. V2 otherwise imports
   into the server's default location, even when `info.location` is present.
   On success, move the archive into `archives/restored/` as a retained backup.

For a local directory that has been removed, V2's interrupt endpoint can return
500 while export and deletion still work. The plugin tolerates that response
only when the local filesystem reports `ENOENT`, no workspace is attached, and
the server's active-session list confirms the session is inactive. It skips
runtime/shell calls for that session's unavailable location and checks inactivity
again before saving and deleting. Other errors still abort archival. Restoring
such an archive uses its original location, so recreate that directory first.

Only the parent transcript and metadata return. Pending inbox work, child sessions,
and processes do not return. Import does not submit a prompt. Failed deletion or
import retains the archive; errors are surfaced for manual retry. If deletion fails,
the remaining live row takes precedence when the picker next loads it.
An existing child archive requires its parent to be live; restore the parent
archive first. The plugin explains this ordering when the parent is missing.

## Effect execution and diagnostics

The plugin owns the session controller and its reactive state. Picker views
consume that state and dispatch commands; focus, keybindings, layout, and scroll
handling stay in the view. Closing a picker detaches its reads and view bindings,
while in-progress lifecycle actions remain owned by the controller so reopening
observes the same operation. This uses Solid and the existing Effect runner,
without a separate caching or scheduling framework.

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

Closing the picker interrupts its read jobs; switching selection cancels obsolete
preview/context jobs. Read HTTP calls receive cancellation signals. Once started,
the cleanup/restore transaction continues independently of picker dismissal so
closing the dialog does not strand it between export and deletion. Host cache and
storage methods also have no cancellation API. Lifecycle completion and failures
remain observable after closing the picker. Mutations are not automatically retried.

## Verification

```sh
bun run check
bun test --preload @opentui/solid/preload
bun run check:api /path/to/project
bun run verify:v2
bun run verify:soft-archive
```

### Attention API compatibility

Badges and session previews use the documented TUI APIs:
`data.session.permission.{list,sync,invalidate}`, `data.session.form.{list,sync,invalidate}`,
and `data.session.status`. Host caches are the source of pending-request state;
the plugin tracks refresh health, not a second event-maintained request inventory.
Events trigger synchronization; reconnects reconcile missed events. Overlapping
refreshes are serialized and rechecked when an event arrives mid-flight.

`src/attention-api.ts` isolates direct attention client calls needed for
cross-location discovery and permission replies. It uses the host's connected,
authenticated client and checks runtime capabilities and returned list shapes.
Known pending requests remain visible when another location is unavailable;
failed/unknown status is never treated as verified idle. A parent inherits a
descendant's attention or unavailable status.

The dependency pins only govern local checks; OpenCode supplies the runtime
client and TUI data APIs. After upgrading OpenCode, run `check:api` against the
already-running service. This smoke check discovers and authenticates to that
service without starting it, allows only GET/HEAD requests, samples session
request reads, and checks approval/interrupt field names in its OpenAPI contract.
It prints counts, not request contents. It does not prompt, approve, interrupt,
or create/delete sessions. The optional argument chooses the location to probe
(default: current directory). Empty services skip session-specific probes.
This checks the actual HTTP API; TUI cache compatibility is checked in the
plugin at runtime and by the rendered picker tests. No version-based stability
guarantee is assumed.

`verify:v2` is an opt-in integration check against the discovered running service.
It creates disposable sessions, transcript fixtures, and short-lived shells,
checks the real archive/restore round trip, and cleans up its fixtures. It uses
a temporary archive directory and never submits a model prompt. The server
must be able to access the temporary directory on the machine running the check;
this script is intended for a local service, not a different remote host.

`verify:soft-archive` checks the new cleanup against disposable parent/child sessions,
parked synthetic inbox items, and tracked shells. It verifies retained transcripts,
empty inboxes, inactive execution, and preservation of an unrelated shell. It does
not generate model responses or restart the shared service; restart recovery and
future external submissions are outside this check.

## Local setup

Install dependencies:

```sh
bun install
```

Add the plugin directory to `~/.config/opencode/cli.json`:

```json
{
  "plugins": ["/absolute/path/to/oc-plugin-session-manager"]
}
```

Restart the OpenCode TUI after changing the plugin configuration.

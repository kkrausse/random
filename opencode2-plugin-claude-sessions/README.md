# Sessions viewer

Package/directory: `opencode2-plugin-claude-sessions` (kept for existing plugin configurations).

Adds Claude Code-style session navigation to the OpenCode V2 terminal UI:

- Press `Left` while the focused prompt is empty to open a status-aware session picker.
- Press `Left` while the prompt contains text to move the cursor normally.
- Press `Alt+S` to open the picker globally, including from permission and question prompts.
- Labeled sections with prominent dividers show **Needs input → Working → Active · ready → Inactive**.
- Press `x` on a session to interrupt it and mark it inactive; press `r` to restore it to the active section without starting work. These shortcuts keep the picker open.
- After `x` or `r` succeeds, selection moves to the next row in the original section, or the previous row at the end of that section, while preserving the scroll offset. If the section had only one row, selection falls back to **New session**. Navigating while the request is pending keeps your newer selection.
- Inactive sessions retain their history, remain selectable below the divider, and use subdued titles. The marker persists across restarts and synchronizes across TUI instances using plugin storage.
- Permissions/questions always appear in **Needs input**, even for sessions marked inactive. Running sessions likewise remain in **Working** until they stop. Opening an inactive session to inspect it does not restore it; use `r` to keep it active again.
- Stopping uses OpenCode's `session.interrupt({ continue: false })`. This is a session interrupt, not a guaranteed kill of detached/background processes or child sessions. The shell API has no dedicated session-owner field for reliably identifying all processes to terminate.
- Status indicators match OpenCode V2 tabs: `!` for permissions, `?` for questions, and a Braille spinner for running sessions.
- Indicators use the active theme's semantic status colors.
- Sessions within each group are ordered by their latest interaction.
- The wide, two-line picker leaves room for session titles, locations, agents, and status details.
- The current session is selected initially; from Home, `New session` is selected.
- Use `Up`/`Down` to select, `Right` or `Enter` to open, and `Left` or `Escape` to close.
- Press `N` from the picker to start a new session.
- Click a row or use the arrow keys to preview it below the list without changing the session behind the dialog. Hovering does not change selection, so you can move the mouse to the taller preview and scroll long commands without switching requests.
- Pending permissions show the action, message, resources, and any metadata in a scrollable preview. Press `a` to approve **once**, `A` (shift) to always approve, or `d` to deny the displayed request. The picker stays open; multiple requests are handled one at a time, never as a bulk approval.
- Pending questions show their title and field details; open the session to answer them. Approval shortcuts do not answer or dismiss questions.
- Preview loading/errors disable permission actions, replies cannot overlap, and held-key repeat events are ignored. Errors appear as toasts and requests refresh after replying.
- Older sessions load as you scroll.

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
failures retain the previous data. Interrupt and marker-persistence failures are
reported as distinct steps, so a storage failure can say the interrupt already
succeeded.

Closing the picker interrupts its jobs; switching selection cancels obsolete
preview/context jobs. HTTP calls receive cancellation signals. Host cache and
storage methods have no cancellation API, so their underlying work may complete,
but interrupted Effects do not continue with stale results. Mutations are not
automatically retried. This improves diagnostics; it does not establish the cause
of the original “Unexpected Status” failure.

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

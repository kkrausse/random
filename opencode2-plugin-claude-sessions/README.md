# Sessions viewer

Package/directory: `opencode2-plugin-claude-sessions` (kept for existing plugin configurations).

Adds Claude Code-style session navigation to the OpenCode V2 terminal UI:

- Press `Left` while the focused prompt is empty to open a status-aware session picker.
- Press `Left` while the prompt contains text to move the cursor normally.
- Press `Alt+S` to open the picker globally, including from permission and question prompts.
- Labeled sections with prominent dividers show **Needs input → Working → Active · ready → Inactive**.
- Press `x` on a session to interrupt it and mark it inactive; press `r` to restore it to the active section without starting work. These shortcuts keep the picker open.
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

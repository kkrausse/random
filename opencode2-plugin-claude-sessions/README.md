# Sessions viewer

Package/directory: `opencode2-plugin-claude-sessions` (kept for existing plugin configurations).

Adds Claude Code-style session navigation to the OpenCode V2 terminal UI:

- Press `Left` while the focused prompt is empty to open a status-aware session picker.
- Press `Left` while the prompt contains text to move the cursor normally.
- Press `Alt+S` to open the picker globally, including from permission and question prompts.
- Sessions needing input appear first, followed by working sessions, then idle sessions.
- Status indicators match OpenCode V2 tabs: `!` for permissions, `?` for questions, and a Braille spinner for running sessions.
- Indicators use the active theme's semantic status colors.
- Sessions within each group are ordered by their latest interaction.
- The wide, two-line picker leaves room for session titles, locations, agents, and status details.
- The current session is selected initially; from Home, `New session` is selected.
- Use `Up`/`Down` to select, `Right` or `Enter` to open, and `Left` or `Escape` to close.
- Press `N` from the picker to start a new session.
- Hover a row or use the arrow keys to preview it below the list without changing the session behind the dialog.
- Pending permissions show the action, message, resources, and any metadata in a scrollable preview. Press `a` to approve **once**, or `d` to deny the displayed request. The picker stays open; multiple requests are handled one at a time, never as a bulk approval.
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

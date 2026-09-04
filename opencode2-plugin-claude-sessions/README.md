# opencode2-plugin-claude-sessions

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

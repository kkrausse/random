# opencode2-plugin-claude-sessions

Adds Claude Code-style session navigation to the OpenCode V2 terminal UI:

- Press `Left` while the focused prompt is empty to open a status-aware session picker.
- Press `Left` while the prompt contains text to move the cursor normally.
- Sessions needing input appear first, followed by working sessions, then idle sessions.
- Sessions within each group are ordered by their latest interaction.
- Use `Up`/`Down` to select, `Right` or `Enter` to open, and `Left` or `Escape` to close.
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

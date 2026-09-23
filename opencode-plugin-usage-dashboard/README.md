# OpenCode usage dashboard

An OpenCode V2 CLI plugin with a `/usage` dashboard for local session statistics and optional `codex-usage` account allowances.

Add this directory to `plugins` in `~/.config/opencode/cli.json`, restart OpenCode, then run `/usage` or choose **Open usage dashboard** from the command palette. `codex-usage` must be on the TUI process's `PATH` to show account allowances; the rest of the dashboard works without it.

Use `1`–`4` to select 24 hours, today, 7 days, or 30 days; `m` cycles the chart metric; `p` toggles all/current project; `r` refreshes; `Esc` returns to the previous session or home. Times use the local timezone. Recorded cost comes from OpenCode sessions and may differ from provider billing. Codex percentages and reset times are local account allowances, not consumption attributable to these sessions.

Run `bun install` and `bun run check` to type-check the plugin.

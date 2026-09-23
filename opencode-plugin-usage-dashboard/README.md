# OpenCode usage dashboard

An OpenCode V2 CLI plugin with a `/usage` dashboard for local session statistics and optional `codex-usage` account allowances.

Add this directory to `plugins` in `~/.config/opencode/cli.json`, restart OpenCode, then run `/usage` or choose **Open usage dashboard** from the command palette. `codex-usage` must be on the TUI process's `PATH` to show account allowances; the rest of the dashboard works without it.

Use `1`–`5`, the clickable period choices, or `t` to select 24 hours, today, the last 7, 14, or 30 calendar days. `m` cycles the chart metric (including estimated spend); `p` toggles all/current project; `r` refreshes; `Esc` returns to the previous session or home. Times use the local timezone. Chart labels mark each bar's time window or calendar date, and grouped bars show their inclusive date range.

Click a chart metric to switch the graph, a model row to filter it (click it again or the TOTAL row to clear), the chart to inspect a time bucket, a tool row for call details, or a Codex row for its full reset details. The project label toggles project scope. Model rows combine all variants for the same provider and model; the TOTAL row covers the selected period. Total tokens include input, output, reasoning, and cache read/write.

**Estimated model spend** prices each response at its model's quoted per-million-token rates, including context-tier rates and cache read/write. When an OpenAI account model has no published rate, the dashboard uses the equivalent OpenCode Zen model's list price. This is a quoted equivalent, **not actual subscription billing**. Positive recorded charges are used as-is; unpriced responses are counted and excluded from the estimate. Codex percentages and reset times are local account allowances, not consumption attributable to these sessions.

Run `bun install` and `bun run check` to type-check the plugin.

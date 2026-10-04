# OpenCode usage dashboard

An OpenCode V2 CLI plugin with a `/usage` dashboard for local session statistics and ChatGPT/Codex account allowances. No standalone `codex-usage` dependency is needed.

Add this directory to `plugins` in `~/.config/opencode/cli.json`, restart OpenCode, then run `/usage` or choose **Open usage dashboard** from the command palette.

Allowances automatically use all OpenAI OAuth accounts saved in the local OpenCode database (opened read-only). This retains multi-account support without switching the active account. Requests go directly to ChatGPT's usage endpoint; expired OpenCode tokens must be refreshed by using the account in OpenCode.

If no OpenCode OAuth accounts are available, the plugin invokes the standard `codex app-server --stdio` and reads `account/read` and `account/rateLimits/read` over JSON-RPC. Install Codex on the TUI process's `PATH` and run `codex login` with a ChatGPT account. It respects `CODEX_HOME` and `CODEX_BIN`; OpenCode account discovery respects `OPENCODE_DB` and `OPENCODE_BIN`. No model turns are started. The rest of the dashboard works even when allowances are unavailable.

The standalone helper's `accounts.json` is no longer consulted. For a specific Codex login, set `CODEX_HOME`; saved OpenCode OAuth accounts take precedence. With a remote OpenCode server, allowances still describe accounts on the machine running the TUI.

Use `1`–`5`, the clickable period choices, or `t` to select 24 hours, today, the last 7, 14, or 30 calendar days. `m` cycles the chart metric (including estimated spend); `p` toggles all/current project; `r` refreshes; `Esc` returns to the previous session or home. Times use the local timezone. Chart labels mark each bar's time window or calendar date, and grouped bars show their inclusive date range.

Click a chart metric to switch the graph, a model row to filter it (click it again or the TOTAL row to clear), the chart to inspect a time bucket, a tool row for call details, or a Codex row for its full reset details. The project label toggles project scope. Model rows combine all variants for the same provider and model; the TOTAL row covers the selected period. Total tokens include input, output, reasoning, and cache read/write.

**Estimated model spend** prices each response at its model's quoted per-million-token rates, including context-tier rates and cache read/write. When an OpenAI account model has no published rate, the dashboard uses the equivalent OpenCode Zen model's list price. This is a quoted equivalent, **not actual subscription billing**. Positive recorded charges are used as-is; unpriced responses are counted and excluded from the estimate. Codex percentages and reset times are local account allowances, not consumption attributable to these sessions.

Run `bun install` and `bun run check` to type-check the plugin.

The account table labels returned allowance windows as Weekly, Daily, or their duration (for example, 5-hour). **Credits** shows the ordinary credit balance or availability; **Resets left** is the separate allowance-reset credit count. Only windows returned by the account are displayed.

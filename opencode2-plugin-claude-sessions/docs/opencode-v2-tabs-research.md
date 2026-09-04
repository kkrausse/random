# OpenCode V2 tabs research

Research captured while redesigning the Claude-style session picker.

## Local source checkout

- Repository: `~/Documents/repos/anomalyco/opencode`
- OpenCode V2 source branch: `origin/beta`
- Do **not** use the default `dev` branch for this plugin work; it currently contains the V1 TUI.
- Installed comparison build during research: `opencode2 v0.0.0-beta-19086`

Useful commands:

```sh
git -C ~/Documents/repos/anomalyco/opencode fetch origin beta
git -C ~/Documents/repos/anomalyco/opencode show origin/beta:packages/tui/src/component/session-tabs.tsx
```

## Canonical tab indicators

Source: [`packages/tui/src/component/session-tabs.tsx`](https://github.com/anomalyco/opencode/blob/beta/packages/tui/src/component/session-tabs.tsx)

OpenCode's `TabIndicator` uses:

| State | Glyph | Semantic color |
| --- | --- | --- |
| Permission required | `!` | `theme.text.status.permission` |
| Question required | `?` | `theme.text.status.question` |
| Running | Braille spinner (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) | normal indicator color |
| Unread activity | `•` | `theme.text.status.unread` |
| Unread error | `•` | `theme.text.feedback.error.default` |
| Idle/read | blank | n/a |
| New session | `+` | normal indicator color |

Related sources:

- Spinner frames: [`packages/tui/src/component/spinner-frames.ts`](https://github.com/anomalyco/opencode/blob/beta/packages/tui/src/component/spinner-frames.ts)
- Status behavior tests: [`packages/tui/test/component/session-tabs-status.test.tsx`](https://github.com/anomalyco/opencode/blob/beta/packages/tui/test/component/session-tabs-status.test.tsx)
- Built-in session picker: [`packages/tui/src/component/dialog-session-list.tsx`](https://github.com/anomalyco/opencode/blob/beta/packages/tui/src/component/dialog-session-list.tsx)
- General select dialog layout: [`packages/tui/src/ui/dialog-select.tsx`](https://github.com/anomalyco/opencode/blob/beta/packages/tui/src/ui/dialog-select.tsx)
- V2 CLI plugin docs: <https://opencode.ai/v2/docs/build/plugins/cli>
- V2 tabs config docs: <https://opencode.ai/v2/docs/cli/config#tabs>

## Visual verification

The V2 TUI was launched at 180×42 with an isolated temporary CLI config and tabs enabled. An attention tab rendered `!` in the theme's purple permission color; the active `+ New session` tab used a stronger background and bold title. This agrees with the source and tests above.

## Picker implementation implication

OpenTUI's basic `SelectRenderable` only accepts string `name` and `description` values. It cannot color a status glyph independently from the session title. A genuinely tab-like picker therefore needs custom JSX rows (or a future public host component), rather than embedding glyphs in the existing `<select>` strings.

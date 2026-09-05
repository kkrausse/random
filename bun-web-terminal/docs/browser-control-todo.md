# Browser Control testing notes / follow-up

## 2026-09-05: installed CLI differs from running relay

- Context: fresh browser automation for the terminal test instance on port 3107; no user-owned terminal tab selected.
- Installed CLI: 0.5.1, build `2026-08-23T23:42:36.863Z`.
- Running relay: 0.7.0, build `2026-09-05T19:03:42.828Z`; extension connected, protocol 2.
- Reproduction: `browser-control execute 'return page.url()'` fails with `Missing required flag: --json`. Adding `--json` fails with `Running relay build 2026-09-05T19:03:42.828Z does not match CLI build 2026-08-23T23:42:36.863Z; restart the relay.`
- Expected: the documented execute command works with the compatible running relay.
- Recovery: used `bunx @opencode-ai/browser-control@latest execute ...`, which worked with the existing relay. No relay restart was needed.
- [ ] Align the globally installed CLI with the current Browser Control package when updating local tooling.

## Locator note

Browser Control 0.7.0: `getByRole("textbox", { name: "Terminal input" }).focus()` fails strict-mode resolution because Ghostty exposes both its main container and a textarea with that label. Use the inspected `#terminal` locator for terminal keyboard focus; this recovered successfully.

A subsequent `waitForFunction(() => document.title.includes("btop"))` exceeded the shell's 30-second deadline: the app was running, but tmux's default pane title was the hostname. A short page inspection and screenshot confirmed the working btop screen. The wrapper now falls back to the pane's current command when its title is still the default hostname.

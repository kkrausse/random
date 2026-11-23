# faplex-web

A phone-first web app for [faplex](https://github.com/kkrausse/faplex): your Claude Code, Codex and
OpenCode sessions as a scrollable list of cards, and the harness's own terminal UI when you open
one. Everything goes through the faplex CLI; nothing here talks to a harness directly.

| In the app | faplex command |
|---|---|
| The list (live) | `faplex watch --json`, one long-running process |
| Last reply on a card | `faplex tail <key> -n 2` (Claude, OpenCode) |
| Reply from a card | `faplex send <key>` (queued after the current turn if it's working) |
| Opening a session | the Unix socket `watch` reports: the client it keeps for that session |
| New session (+) | `faplex new --machine … --harness … --background` |

The session screen is a ghostty-web terminal with two floating buttons, Paste copied
from bun-web-terminal. Keyboard raises or lowers the keyboard; typing (dictation included) goes
straight into the harness, and tapping the terminal never raises it. Paste does one clipboard
read: text is pasted, and a screenshot is uploaded to the session's machine (`/tmp/faplex-web/`,
over ssh for a remote one) and its path pasted, which Claude takes as an image. On opening, and on
coming back to the page, the session is reattached and made to redraw by a one-row resize and
back; ⋮ → Redraw does it by hand. Text size is in ⋮ too. ← at an empty prompt or ctrl+] leaves the
session, as in faplex.

## Run

```sh
bun install
PORT=14797 CREDENTIAL_PORT=14790 bun src/server.ts
```

It listens on 127.0.0.1 only. The client is built into `dist/` at startup, so restart after
client changes. `bun-web-terminal/` and `ghostty-web/` must be siblings: sign-in, the Ghostty
theme, and touch/wheel/link handling come from there.

Sign-in is the web terminal's: the same access key and login page. `CREDENTIAL_PORT` picks which
of its stored credentials to use (14790 is the running web terminal's, so one saved key works for
both). Each origin still signs in once.

Environment: `PORT` (default 14797), `CREDENTIAL_PORT` (default 14790), `PUBLIC_URL` (the
HTTPS origin it is served at, required for sign-in there), `FAPLEX_BIN` (default `faplex`),
`FAPLEX_CWD` (where `faplex` runs; a local machine's default start folder).

## On diesel2

The systemd user unit `faplex-web` runs it, and Tailscale Serve publishes it tailnet-only at
https://diesel2.guineafowl-truck.ts.net:9447 (`sudo tailscale serve --bg --https=9447 http://127.0.0.1:14797`).
The unit's `PATH` must reach `faplex`, `claude`, `opencode` and `codex`.

```sh
systemctl --user restart faplex-web     # after changes
journalctl --user -u faplex-web -f
```

Add it to an iPhone home screen from Safari's share menu for a full-screen app. It signs in once
more there, since home-screen apps keep their own cookies.

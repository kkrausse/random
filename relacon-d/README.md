# relacon-d

A small macOS daemon that remaps the ELECOM Relacon Bluetooth trackball (vendor
1390, product 342), and only that device. Behavior lives in a TypeScript config
that reloads when you save it. Design: [DESIGN.md](DESIGN.md).

## Install

```sh
scripts/install.sh          # build, bundle, sign, install ~/Applications/Relacon.app,
                            # write ~/Library/LaunchAgents/com.kkrausse.relacon-d.plist
scripts/install.sh --load   # same, then (re)start the LaunchAgent
```

The script signs with `$RELACON_CODESIGN_IDENTITY` if set. Otherwise it uses a
"Developer ID Application" identity (`RELACON_TEAM_ID` narrows it to one team),
then an "Apple Development" identity. Both give a stable designated requirement,
so permission grants survive rebuilds. If neither exists it falls back to ad-hoc
signing with a warning. With ad-hoc signing, grants break on every rebuild.

On first install it writes a starter `~/.config/relacon/config.ts` plus
`relacon.d.ts` next to it, so your editor gets types. An existing config is left
alone.

Start/stop by hand:

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.kkrausse.relacon-d.plist
launchctl bootout   gui/$(id -u)/com.kkrausse.relacon-d
```

Don't run it while Karabiner-Elements is remapping the Relacon, or every input
gets mapped twice.

## Permissions

Relacon.app needs both of these (System Settings > Privacy & Security):

- **Input Monitoring**, to read the device through IOHIDManager.
- **Accessibility**, for the active event tap and to post events.

On first run the daemon asks for both. Once you grant them it picks them up by
itself within a few seconds, no restart needed. When you run `relacon-d events`
from a terminal, the terminal app is the one that needs Input Monitoring.

## Config

`~/.config/relacon/config.ts`, often a symlink into dotfiles. If
`~/.config/relacon/local.ts` exists, it's loaded after `config.ts` and can add
or override bindings. Saving either file reloads the config. If the new config
has an error, the daemon keeps the old one, logs the error with `file:line`, and
posts a notification.

```ts
bind("wheel", key("right_option"));   // hold the wheel to dictate (Hex)
```

See `examples/config.ts` for tapHold, layers, chords, sequences, gestures,
scroll handlers and per-app bindings, and `relacon.d.ts` for the full API.
Buttons you don't bind keep their normal behavior.

## CLI

```
relacon-d run                         the daemon (what the LaunchAgent starts)
relacon-d events [--motion] [--suppress]
                                      print raw events with attribution diagnostics
relacon-d check [path] [--call]       load + validate a config; --call also runs each
                                      function once (nothing is sent)
relacon-d reload                      tell the running daemon to reload
```

`events` prints one line per button, media key and scroll event. Each line shows
the CGEvent sender ID, whether that ID belongs to the Relacon, the Relacon's HID
state, and the verdict: `RELACON via sender-id`, `via hid-correlation`, or
`not relacon`. It also prints the raw HID values from the device. Motion is
summarized once a second, or printed per event with `--motion`. `--suppress`
swallows events attributed to the Relacon, which shows whether suppression
works. It needs Accessibility.

Environment: `RELACON_CONFIG` overrides the config path. `RELACON_TAP=session`
installs the tap at the session level instead of the HID level.

Log: `~/Library/Logs/relacon-d.log`.

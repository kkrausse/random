# relacon-d — design

A tiny macOS daemon that remaps the ELECOM Relacon (Bluetooth trackball,
vendor `1390`, product `342`). The Rust core does all the OS plumbing; behavior
lives in a TypeScript config file that's hot-reloaded on save. It replaces
Karabiner-Elements (and the Hammerspoon we didn't install) with one tool.

## Goals

- Remap every Relacon input: buttons, media buttons, scroll, and pointer motion
  (for gestures), **only for this device**. Trackpad and keyboards are untouched.
- Tap vs hold, hold-layers, simultaneous chords, sequences, gestures
  (hold + flick direction), layer-dependent scroll, per-app bindings.
- Edit `config.ts`, save, and the change is live: no rebuild, no restart, no
  re-granting permissions.
- One signed binary holds the two permissions (Input Monitoring + Accessibility).

## Non-goals

- Other devices (keep the device match a constant, maybe a config field later).
- GUI, login screen, secure-input/password fields.
- Type-checking at runtime (types are stripped, the editor checks them via `relacon.d.ts`).

## The device

From the Karabiner logging session (2026-11-01):

| Physical button      | Arrives as                               | Config name   |
|----------------------|------------------------------------------|---------------|
| Bottom trigger       | left mouse button (button 0 in CG terms) | `left`        |
| Upper trigger        | right mouse button                       | `right`       |
| Scroll-wheel press   | other mouse button 2 (`button3`)         | `wheel`       |
| Left arrow           | other mouse button 3 (`button4`, back)   | `back`        |
| Right arrow          | other mouse button 4 (`button5`, fwd)    | `forward`     |
| Rewind               | consumer `scan_previous_track`           | `prev`        |
| Fast-forward         | consumer `scan_next_track`               | `next`        |
| Play                 | consumer `play_or_pause`                 | `play`        |
| Volume +             | consumer `volume_increment`              | `volUp`       |
| Volume −             | consumer `volume_decrement`              | `volDown`     |
| Scroll up / down     | discrete scroll-wheel events             | `scroll`      |
| Ball                 | pointer motion                           | `motion`      |
| Side DPI/pair button | handled in hardware, never reaches macOS | —             |

Unverified: whether the Relacon also has a horizontal wheel/tilt. `relacon-d events`
(below) settles it.

## Architecture

Everything runs on **one thread** with one `CFRunLoop`: the event tap, the HID
manager callbacks, timers, file watching, and the JS engine. QuickJS is
single-threaded anyway and this removes all locking. Handlers must stay fast
(microseconds); the tap is re-enabled if macOS ever disables it.

```
Relacon ──BT──▶ macOS HID ──▶ CGEvent stream ──▶ [our CGEventTap] ──▶ apps
                    │                                │  ▲
                    └─ IOHIDManager (match 1390:342) │  │ synthesized events
                       → registry IDs of the device  ▼  │ (tagged, skipped by tap)
                                                  engine.rs ◀──▶ QuickJS (config.ts)
```

### Device attribution (milestone 1 spike, decide before anything else)

The tap sees events from every device; we must act only on the Relacon's.

1. **Primary: CGEvent sender ID.** `CGEventGetIntegerValueField(ev, 87)`
   (undocumented `kCGEventSenderID`) holds the registry entry ID of the
   IOHIDService that produced the event. LinearMouse (open source) relies on this.
   IOHIDManager gives us the Relacon's `IOHIDDevice`; map it to its service
   registry ID(s) and compare. Recompute on connect/disconnect.
2. **Fallback: HID-state correlation.** IOHIDManager input-value callbacks tell us
   "Relacon button 3 is down / play was pressed / wheel moved". If a CG event
   doesn't carry a usable sender ID, attribute it to the Relacon when the matching
   HID value arrived within a few ms. Needed possibly for the media keys (see below).

The spike must confirm, for each input class, which method works:
mouse buttons, NX_SYSDEFINED media keys, discrete scroll, mouse moved/dragged.

**Media keys** reach the tap as `NX_SYSDEFINED` (type 14), subtype 8, with
`data1 = (keyCode << 16) | (keyState << 8)`; keyState `0xA` down / `0xB` up.
Key codes: `SOUND_UP 0`, `SOUND_DOWN 1`, `PLAY 16`, `NEXT 17`, `PREVIOUS 18`,
`FAST 19`, `REWIND 20`. Volume may additionally be swallowed by the system HUD
path; the spike checks we can suppress it.

**Do not seize the device** (`kIOHIDOptionsTypeSeizeDevice`). Seizing means
re-synthesizing pointer motion ourselves and losing macOS acceleration. We only
observe via IOHID and filter/rewrite in the tap.

### Output

All via `CGEventPost(kCGHIDEventTap, …)` with a private `CGEventSource`, and
every synthesized event tagged with `kCGEventSourceUserData = RELACON_MAGIC` so
the tap passes our own events through untouched.

- **Keys / chords:** keyDown/keyUp with flags. Modifier keys need real
  `flagsChanged` events including the device-dependent bits, e.g. right option =
  keycode 61 + `NX_ALTERNATEMASK | NX_DEVICERALTKEYMASK (0x40)`. Hex
  (`hex-rust`, `src/app_settings.rs` `RIGHT_OPTION_MASK`) checks the 0x40 bit,
  so this is what makes dictation work.
- **Media keys:** synthesize NX_SYSDEFINED events (same encoding as above).
- **Mouse buttons, scroll** (line + pixel), **shell commands** (`/bin/sh -c`,
  detached, stdout/stderr to the log).
- Held outputs are tracked so a config reload, layer change, or device
  disconnect releases everything that's still down (no stuck modifiers).

### Engine (Rust) vs config (JS)

The engine owns the timing-sensitive state machines in Rust: tap-vs-hold,
chords, sequences, gesture recognition, layer stack, held-output bookkeeping.
The config only declares bindings and supplies handler functions. This keeps
JS off the hot path for motion events (only called when a gesture/scroll
handler actually fires) and makes behavior predictable.

### Hot reload

- Config path: `~/.config/relacon/config.ts` (symlink into dotfiles). If
  `~/.config/relacon/local.ts` exists (untracked, for anything private), it's
  loaded after `config.ts` and can add/override bindings.
- Watch the **resolved** file and its directory with FSEvents (editors save by
  rename). Debounce ~100 ms.
- Load = read → strip types with `oxc` (`oxc_transformer` TS strip, no
  type-check) → fresh QuickJS context → evaluate → collect bindings.
  On any error: keep the previous config, log the error with file:line, post
  a macOS notification.
- QuickJS interrupt handler aborts any handler that runs > 50 ms.

## Config API

Ships as `relacon.d.ts` next to the config for editor autocomplete. Sketch:

```ts
type Button = "left" | "right" | "wheel" | "back" | "forward"
            | "prev" | "next" | "play" | "volUp" | "volDown";
type Action = KeyAction | MediaAction | ClickAction | RunAction | LayerAction
            | SeqAction | Action[] | ((ctx: Ctx) => void);

// outputs
key("cmd+shift+k")        // tapped if the trigger is tapped; HELD while the trigger is held
key("right_option")       // e.g. hold-to-dictate with Hex
media("play" | "next" | "prev" | "volUp" | "volDown" | "mute")
click("left" | "right" | "middle" | "back" | "forward")
run("open -a Ghostty")    // shell command
seq(key("cmd+k"), key("cmd+s"))
passthrough               // keep the original behavior

// inputs
bind(button, action)
tapHold(tap: Action, hold: Action, opts?: { ms?: number })  // default 200 ms
layer("nav")                                                // as an action: hold = layer active
defineLayer("nav", { back: key("ctrl+left"), scroll: (dy) => ... })
chord(["prev", "next"], action, { ms?: 50 })               // pressed together
sequence(["play", "volUp"], action, { ms?: 800 })           // pressed in order
gesture(button, { left?, right?, up?, down?, tap? }, { threshold?: 40 })
                                                            // hold + flick; tap = no movement
onScroll((dy, ctx) => "pass" | void)                        // base-layer scroll
app("com.mitchellh.ghostty", { play: key("cmd+t") })        // per-app overrides (bundle id)

// ctx: { app: string /* frontmost bundle id */, layers: string[], log(...) }
```

Starting config (current Karabiner behavior + example):

```ts
bind("wheel", key("right_option"));   // hold to dictate (Hex)
// everything else passes through until we pick bindings
```

Unbound buttons pass through unchanged.

## CLI

```
relacon-d run              # the daemon (what the LaunchAgent starts)
relacon-d events           # print attributed raw events from the Relacon (replaces Karabiner-EventViewer)
relacon-d check [path]     # load + validate a config without applying it
relacon-d reload           # nudge the running daemon (also happens on save)
```

Log: `~/Library/Logs/relacon-d.log`.

## Packaging & permissions

- Minimal bundle `Relacon.app` (`LSUIElement`, bundle id `com.kkrausse.relacon-d`)
  so it shows up by name under Privacy & Security.
- Signed with the user's Developer ID (same approach as
  `hex-rust/scripts/macos-signing.sh`; env override `RELACON_CODESIGN_IDENTITY`)
  so TCC grants survive rebuilds. Ad-hoc signing is NOT enough (cdhash changes).
- Installed to `~/Applications/Relacon.app`; LaunchAgent
  `~/Library/LaunchAgents/com.kkrausse.relacon-d.plist` with `KeepAlive`, `RunAtLoad`.
- `scripts/install.sh`: cargo build --release → bundle → sign → install →
  `launchctl bootout/bootstrap gui/$UID`. Idempotent.
- Permissions: **Input Monitoring** (IOHIDManager) and **Accessibility**
  (active event tap + posting). On missing permission, log clearly and
  call `IOHIDRequestAccess` / `AXIsProcessTrustedWithOptions` prompt.
- Survive sleep/wake and Bluetooth reconnects (IOHIDManager matching callbacks).

## Crates

`core-foundation`, `core-graphics` (+ raw FFI where the crate lacks fields),
`io-kit-sys` or hand-written IOHID FFI, `rquickjs` (QuickJS-ng), `oxc_*`
(parser + transformer for TS strip), `notify` or raw FSEvents, `anyhow`, `log`.

## Milestones

1. **Spike / `relacon-d events`:** tap + IOHID, prove device attribution for
   buttons, media keys, scroll, motion; prove we can suppress each one.
2. **Dictation parity:** outputs, QuickJS + oxc + hot reload, `bind` + `key`
   with held semantics. Switch the wheel-click dictation over from Karabiner.
3. **Full engine:** tapHold, layers, chords, sequences, gestures, onScroll, app().
4. **Packaging:** bundle, signing, LaunchAgent, install script, README.
5. **Retire Karabiner:** user runs `brew uninstall --cask karabiner-elements`.

## Testing

No unit-test suite up front (per the user's preference). Verify by hand with
`relacon-d events` and the real device. Add a focused test only if a timing
state machine regresses.

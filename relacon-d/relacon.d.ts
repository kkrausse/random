// Type declarations for relacon-d config files (~/.config/relacon/config.ts).
// Everything here is a global: no imports needed. Types are stripped at load time
// (not checked), so this file is for your editor only. Put it next to config.ts or
// reference it with: /// <reference path="./relacon.d.ts" />

/** Relacon inputs that can be bound. */
type Button =
  | "trigger"         // bottom trigger (left click by default)
  | "leader"          // top bumper (right click by default)
  | "wheel"           // scroll-wheel press (middle click)
  | "left-of-wheel"   // button left of the wheel (mouse back)
  | "right-of-wheel"  // button right of the wheel (mouse forward)
  | "d-left"          // d-pad left  (rewind by default)
  | "d-right"         // d-pad right (fast-forward by default)
  | "d-up"            // d-pad up    (volume up by default)
  | "d-down"          // d-pad down  (volume down by default)
  | "play";           // play/pause

/** Key spec: modifiers joined with "+", then at most one key, e.g. "cmd+shift+k",
 *  "right_option", "ctrl+left". Modifiers: cmd/command, shift, ctrl/control,
 *  opt/option/alt, fn, and left_/right_ variants (right_option, right_command, ...).
 *  Keys: a-z, 0-9, f1-f20, return/enter, tab, space, delete/backspace,
 *  forward_delete, escape/esc, left/right/up/down, home, end, page_up, page_down,
 *  minus, equal, left_bracket, right_bracket, backslash, semicolon, quote, comma,
 *  period, slash, grave, caps_lock (or the punctuation characters themselves). */
type KeySpec = string;

type MediaName = "play" | "next" | "prev" | "volUp" | "volDown" | "mute" | "fast" | "rewind";
type MouseName = "left" | "right" | "middle" | "back" | "forward";

interface KeyAction { readonly type: "key"; readonly spec: KeySpec }
interface MediaAction { readonly type: "media"; readonly name: MediaName }
interface ClickAction { readonly type: "click"; readonly name: MouseName }
interface ScrollAction { readonly type: "scroll"; readonly dy: number; readonly dx: number }
interface RunAction { readonly type: "run"; readonly cmd: string }
interface LayerAction { readonly type: "layer"; readonly name: string }
interface SeqAction { readonly type: "seq"; readonly actions: Action[] }
interface PassthroughAction { readonly type: "passthrough" }

interface Ctx {
  /** Bundle id of the frontmost app, e.g. "com.mitchellh.ghostty". */
  readonly app: string;
  /** Active layers, innermost last. */
  readonly layers: readonly string[];
  /** Horizontal scroll delta (scroll handlers only; 0 otherwise). */
  readonly dx: number;
  /** Write to ~/Library/Logs/relacon-d.log. */
  log(...args: unknown[]): void;
  /** Fire an action right now (tapped). */
  send(action: Action): void;
}

/** A function action runs when the button is pressed. Returning an action presses
 *  it (held while the button is held); returning "pass" keeps the original
 *  behavior; returning nothing just swallows the press. Must finish within 50 ms. */
type FnAction = (ctx: Ctx) => Action | "pass" | void;

/** An array presses all its actions together (and holds them together). */
type Action =
  | KeyAction | MediaAction | ClickAction | ScrollAction | RunAction
  | LayerAction | SeqAction | PassthroughAction | Action[] | FnAction;

interface TapHoldBinding { readonly type: "tapHold"; readonly tap: Action; readonly hold: Action; readonly ms: number }

interface GestureDirections {
  left?: Action;
  right?: Action;
  up?: Action;
  down?: Action;
  /** Released without moving past the threshold. Defaults to the button's normal click. */
  tap?: Action;
}
interface GestureBinding { readonly type: "gesture"; readonly dirs: GestureDirections; readonly threshold: number }

type Binding = Action | TapHoldBinding | GestureBinding;

/** dy: lines (positive = wheel up). Return "pass" to let the scroll through, an
 *  action to fire it, or nothing to swallow the scroll. */
type ScrollHandler = (dy: number, ctx: Ctx) => Action | "pass" | void;

type BindingMap = Partial<Record<Button, Binding>> & { scroll?: ScrollHandler };

// ---------------------------------------------------------------- outputs

/** Press a key combo. Tapped if the trigger is tapped; held while the trigger is held. */
declare function key(spec: KeySpec): KeyAction;
declare function media(name: MediaName): MediaAction;
declare function click(button: MouseName): ClickAction;
/** Synthesize a line scroll. */
declare function scroll(dy: number, dx?: number): ScrollAction;
/** Run a shell command (/bin/sh -c, detached; output goes to the log). */
declare function run(cmd: string): RunAction;
/** Tap each action in order. */
declare function seq(...actions: Action[]): SeqAction;
/** Keep the button's original behavior. */
declare const passthrough: PassthroughAction;
/** As an action: the layer is active while the trigger is held. */
declare function layer(name: string): LayerAction;

// ---------------------------------------------------------------- inputs

/** Bind a button in the base layer. Unbound buttons pass through unchanged. */
declare function bind(button: Button, binding: Binding): void;
/** Tap for one action, hold (past `ms`, default 200) for another. Pressing another
 *  Relacon button while undecided counts as a hold. */
declare function tapHold(tap: Action, hold: Action, opts?: { ms?: number }): TapHoldBinding;
/** Bindings active while `layer(name)` is held. Layers win over app() and bind(). */
declare function defineLayer(name: string, bindings: BindingMap): void;
/** Buttons pressed together within `ms` (default 50). Delays those buttons by up to `ms`. */
declare function chord(buttons: Button[], action: Action, opts?: { ms?: number }): void;
/** Buttons pressed in order, each within `ms` (default 800) of the previous. Delays
 *  the first button until the sequence completes or breaks. */
declare function sequence(buttons: Button[], action: Action, opts?: { ms?: number }): void;
/** Hold `button` and flick the ball (pointer is frozen while held). `threshold` in
 *  pixels, default 40. */
declare function gesture(button: Button, dirs: GestureDirections, opts?: { threshold?: number }): void;
/** Gesture as a binding value, for defineLayer/app. */
declare function gesture(dirs: GestureDirections, opts?: { threshold?: number }): GestureBinding;
/** Base-layer scroll handler (layers can override with `scroll:`). */
declare function onScroll(handler: ScrollHandler): void;
/** Per-app overrides by bundle id. Checked after layers, before bind(). */
declare function app(bundleId: string, bindings: BindingMap): void;

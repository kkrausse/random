/// <reference path="../relacon.d.ts" />
// relacon-d config. Lives at ~/.config/relacon/config.ts; saved changes apply live.
// Unbound buttons pass through unchanged.

// Hold the wheel to dictate with Hex (right option, with the 0x40 device bit).
bind("wheel", key("right_option"));

// ---- examples (uncomment to try) -------------------------------------------

// Tap play for play/pause, hold it for Mission Control.
// bind("play", tapHold(media("play"), key("ctrl+up"), { ms: 250 }));

// Hold "left-of-wheel" for a navigation layer.
// bind("left-of-wheel", layer("nav"));
// defineLayer("nav", {
//   forward: key("cmd+right_bracket"),
//   prev: key("ctrl+shift+tab"),
//   next: key("ctrl+tab"),
//   scroll: (dy) => (dy > 0 ? key("cmd+minus") : key("cmd+equal")),
// });

// Press prev+next together for Spotlight.
// chord(["d-left", "d-right"], key("cmd+space"));

// Press play then volUp to open a terminal.
// sequence(["play", "d-up"], run("open -a Ghostty"));

// Hold "right-of-wheel" and flick: left/right switch desktops, up = Mission Control.
// gesture("right-of-wheel", {
//   left: key("ctrl+left"),
//   right: key("ctrl+right"),
//   up: key("ctrl+up"),
//   down: key("ctrl+down"),
// }, { threshold: 40 });

// Scroll handler for the base layer: horizontal-ish scroll with shift held, etc.
// onScroll((dy, ctx) => {
//   if (ctx.app === "com.apple.Preview") return dy > 0 ? key("cmd+equal") : key("cmd+minus");
//   return "pass";
// });

// Per-app overrides (bundle id).
// app("com.mitchellh.ghostty", {
//   play: key("cmd+t"),
//   volUp: (ctx) => { ctx.log("ghostty volUp"); return key("cmd+shift+right_bracket"); },
// });

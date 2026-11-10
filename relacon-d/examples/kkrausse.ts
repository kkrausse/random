/// <reference path="./relacon.d.ts" />
// relacon-d keymap. Saved changes apply live. Unbound buttons keep their default.
//
// Notation (emacs-style): `leader rw` = tap leader, then tap right-of-wheel.
// `leader rw…` = tap leader, then HOLD right-of-wheel (action held while held).
//
// Button names: trigger, leader, wheel, left-of-wheel (lw), right-of-wheel (rw),
// d-left, d-right, d-up, d-down, play, scroll.
//
// | Key              | Plain            | leader <key>                  |
// |------------------|------------------|-------------------------------|
// | trigger          | left click       | —                             |
// | leader           | (starts leader)  | right click                   |
// | wheel            | middle click     | —                             |
// | lw               | Escape           | Mission Control               |
// | rw               | mouse forward    | rw… = dictate (right option)  |
// | d-left           | ←                | tab search (cmd+shift+a)      |
// | d-right          | →                | —                             |
// | d-up             | ↑                | —                             |
// | d-down           | ↓                | —                             |
// | play             | Enter            | —                             |
// | scroll           | scroll ×2        | arrow mode: up ←, down →      |
//
// leader trigger d-left  -> ctrl+left
// leader trigger d-right -> ctrl+right
// leader trigger scroll -> delete mode: up = backspace, down = forward delete
// (modes last LEADER.ms after the last scroll bump; any button press ends them)

// ---- plain -------------------------------------------------------------------
bind("left-of-wheel", key("escape"));
bind("play", key("return"));
bind("d-left", key("left"));
bind("d-right", key("right"));
bind("d-up", key("up"));
bind("d-down", key("down"));

const SCROLL_SPEED = 2; // multiply wheel steps
onScroll((dy, ctx) => scroll(Math.round(dy * SCROLL_SPEED), Math.round(ctx.dx * SCROLL_SPEED)));

// ---- leader (top bumper) -------------------------------------------------------
// A lone leader tap does nothing; the next press must come within LEADER.ms.
bind("leader", []);
const LEADER = { ms: 1500 };
sequence(["leader", "leader"], click("right"), LEADER);
sequence(["leader", "left-of-wheel"], run("open -a 'Mission Control'"), LEADER);
sequence(["leader", "right-of-wheel"], key("right_option"), LEADER); // hold to dictate
sequence(["leader", "d-left"], key("cmd+shift+a"), LEADER);
sequence(["leader", "trigger", "d-left"], key("ctrl+left"), LEADER);
sequence(["leader", "trigger", "d-right"], key("ctrl+right"), LEADER);

// ---- scroll modes ------------------------------------------------------------------
// Momentum: macOS already accelerates the wheel (slow bump = 1, fast spin = 3, 5, ...),
// so send that many keys per bump, capped at MODE_MAX.
const MODE_MAX = 8;
const repeat = (n: number, a: Action) => seq(...Array(Math.min(MODE_MAX, Math.max(1, Math.round(Math.abs(n))))).fill(a));
defineLayer("arrows", { scroll: (dy) => repeat(dy, key(dy > 0 ? "left" : "right")) });
defineLayer("delete", { scroll: (dy) => repeat(dy, key(dy > 0 ? "delete" : "forward_delete")) });
sequence(["leader", "scroll"], mode("arrows", LEADER), LEADER);
sequence(["leader", "trigger", "scroll"], mode("delete", LEADER), LEADER);

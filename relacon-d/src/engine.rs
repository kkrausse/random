//! The timing-sensitive part: resolves Relacon button/scroll/motion input into
//! outputs according to the loaded config. Owns tap-vs-hold, chords, sequences,
//! gestures, the layer stack and held-output bookkeeping. JS is only called when a
//! function binding actually fires.

use crate::config::{Action, Binding, Button, Config, Gesture, JsCall, JsResult, take_outbox};
use crate::log;
use crate::objc;
use crate::output::Output;
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// How a currently-down button is being handled; decided at press time so a layer
/// or config change in between can't strand a held output.
enum Active {
    /// Original event passed through; its release passes through too.
    Pass,
    /// Output pressed; released with the button.
    Held(Action),
    TapHold { tap: Action, hold: Action, deadline: Instant, holding: bool },
    Gesture { g: Box<Gesture>, dx: f64, dy: f64, fired: bool, native: Action },
    /// Part of a fired chord; the first member released releases the action.
    Chord { action: Action, members: Vec<Button> },
    /// Swallow the release.
    Consumed,
}

struct Pending {
    b: Button,
    down: bool,
    t: Instant,
}

pub enum Motion {
    Pass,
    Swallow,
    /// Turn into a drag of this mouse button (we hold a synthesized button down).
    Drag(u8),
    /// Turn a drag into a plain move (the physical button's down was swallowed).
    Move,
}

pub struct Engine {
    pub cfg: Config,
    pub out: Output,
    layers: Vec<String>,
    active: HashMap<Button, Active>,
    pending: Vec<Pending>,
    pending_deadline: Option<Instant>,
}

impl Engine {
    pub fn new(cfg: Config) -> Engine {
        Engine {
            cfg,
            out: Output::new(),
            layers: vec![],
            active: HashMap::new(),
            pending: vec![],
            pending_deadline: None,
        }
    }

    /// Whether pointer motion currently matters (gesture in progress, or a drag to
    /// rewrite). Lets the tap skip attribution work for ordinary motion.
    pub fn wants_motion(&self) -> bool {
        self.out.held_mouse_button().is_some()
            || self.active.iter().any(|(b, a)| match a {
                Active::Gesture { .. } => true,
                Active::Pass => false,
                _ => b.mouse_number().is_some(),
            })
    }

    pub fn next_deadline(&self) -> Option<Instant> {
        let tap_holds = self.active.values().filter_map(|a| match a {
            Active::TapHold { deadline, holding: false, .. } => Some(*deadline),
            _ => None,
        });
        tap_holds.chain(self.pending_deadline).min()
    }

    // ------------------------------------------------------------ outputs

    fn press(&mut self, a: &Action) {
        match a {
            Action::Key(k) => self.out.key_down(k),
            Action::Media(c) => self.out.media(*c, true),
            Action::Click(n) => self.out.mouse(*n, true),
            Action::Scroll { dy, dx } => self.out.scroll(*dy, *dx),
            Action::Run(c) => self.out.run(c),
            Action::Layer(l) => self.layers.push(l.clone()),
            Action::Seq(v) => v.iter().for_each(|x| self.tap(x)),
            Action::All(v) => v.iter().for_each(|x| self.press(x)),
            Action::Js(id) => {
                if let Some(JsResult::Act(r)) = self.call_js(*id, vec![], 0.0) {
                    self.tap(&r);
                }
            }
            Action::Pass => {}
        }
    }

    fn release(&mut self, a: &Action) {
        match a {
            Action::Key(k) => self.out.key_up(k),
            Action::Media(c) => self.out.media(*c, false),
            Action::Click(n) => self.out.mouse(*n, false),
            Action::Layer(l) => {
                if let Some(i) = self.layers.iter().rposition(|x| x == l) {
                    self.layers.remove(i);
                }
            }
            Action::All(v) => v.iter().rev().for_each(|x| self.release(x)),
            _ => {}
        }
    }

    fn tap(&mut self, a: &Action) {
        self.press(a);
        self.release(a);
    }

    /// Call a config function. `None` on error (logged).
    fn call_js(&mut self, id: usize, args: Vec<f64>, dx: f64) -> Option<JsResult> {
        let js = self.cfg.js.as_ref()?;
        let app = objc::frontmost_app();
        let r = js.call(id, JsCall { args, app: &app, layers: &self.layers, dx });
        for a in take_outbox() {
            self.tap(&a);
        }
        match r {
            Ok(r) => Some(r),
            Err(e) => {
                log!("handler error: {e:#}");
                None
            }
        }
    }

    fn lookup(&self, b: Button) -> Option<Binding> {
        for l in self.layers.iter().rev() {
            if let Some(x) = self.cfg.layers.get(l).and_then(|bs| bs.buttons.get(&b)) {
                return Some(x.clone());
            }
        }
        if !self.cfg.apps.is_empty() {
            let app = objc::frontmost_app();
            if let Some(x) = self.cfg.apps.get(&app).and_then(|bs| bs.buttons.get(&b)) {
                return Some(x.clone());
            }
        }
        self.cfg.base.buttons.get(&b).cloned()
    }

    fn scroll_handler(&self) -> Option<usize> {
        for l in self.layers.iter().rev() {
            if let Some(id) = self.cfg.layers.get(l).and_then(|bs| bs.scroll) {
                return Some(id);
            }
        }
        if !self.cfg.apps.is_empty() {
            let app = objc::frontmost_app();
            if let Some(id) = self.cfg.apps.get(&app).and_then(|bs| bs.scroll) {
                return Some(id);
            }
        }
        self.cfg.base.scroll
    }

    fn in_combo(&self, b: Button) -> bool {
        self.cfg.chords.iter().any(|c| c.buttons.contains(&b))
            || self.cfg.sequences.iter().any(|s| s.buttons.first() == Some(&b))
    }

    // ------------------------------------------------------------ input

    /// Returns true if the original event should be swallowed.
    pub fn on_button(&mut self, b: Button, down: bool, now: Instant) -> bool {
        if down {
            // Key repeat (media keys) or a down we never saw the up for.
            if let Some(a) = self.active.get(&b) {
                return !matches!(a, Active::Pass);
            }
            let pending_down = self.pending.iter().rev().find(|p| p.b == b).map(|p| p.down);
            if pending_down == Some(true) {
                return true;
            }
            self.hold_undecided_tap_holds();
            if !self.pending.is_empty() || self.in_combo(b) {
                self.pending.push(Pending { b, down, t: now });
                self.eval_pending(now);
                return true;
            }
            return self.dispatch_down(b, false, now);
        }
        if self.pending.iter().any(|p| p.b == b) {
            self.pending.push(Pending { b, down, t: now });
            self.eval_pending(now);
            return true;
        }
        self.dispatch_up(b)
    }

    /// Permissive hold: pressing another button while a tapHold is undecided makes
    /// it a hold right away (so hold-layer + button feels instant).
    fn hold_undecided_tap_holds(&mut self) {
        let undecided: Vec<Button> = self
            .active
            .iter()
            .filter(|(_, a)| matches!(a, Active::TapHold { holding: false, .. }))
            .map(|(b, _)| *b)
            .collect();
        for b in undecided {
            self.start_hold(b);
        }
    }

    fn start_hold(&mut self, b: Button) {
        let hold = match self.active.get_mut(&b) {
            Some(Active::TapHold { hold, holding, .. }) if !*holding => {
                *holding = true;
                hold.clone()
            }
            _ => return,
        };
        self.press(&hold);
    }

    fn passthrough(&mut self, b: Button, buffered: bool) -> bool {
        if buffered {
            // The original event is gone; reproduce it.
            let native = b.native();
            self.press(&native);
            self.active.insert(b, Active::Held(native));
            true
        } else {
            self.active.insert(b, Active::Pass);
            false
        }
    }

    fn dispatch_down(&mut self, b: Button, buffered: bool, now: Instant) -> bool {
        match self.lookup(b) {
            None | Some(Binding::Act(Action::Pass)) => self.passthrough(b, buffered),
            Some(Binding::Act(Action::Js(id))) => match self.call_js(id, vec![], 0.0) {
                Some(JsResult::Pass) | None => self.passthrough(b, buffered),
                Some(JsResult::Act(a)) => {
                    // A returned action is held while the button is held.
                    self.press(&a);
                    self.active.insert(b, Active::Held(a));
                    true
                }
                Some(JsResult::Nothing) => {
                    self.active.insert(b, Active::Consumed);
                    true
                }
            },
            Some(Binding::Act(a)) => {
                self.press(&a);
                self.active.insert(b, Active::Held(a));
                true
            }
            Some(Binding::TapHold { tap, hold, ms }) => {
                let deadline = now + Duration::from_millis(ms);
                self.active.insert(b, Active::TapHold { tap, hold, deadline, holding: false });
                true
            }
            Some(Binding::Gesture(g)) => {
                self.active.insert(b, Active::Gesture { g, dx: 0.0, dy: 0.0, fired: false, native: b.native() });
                true
            }
        }
    }

    fn dispatch_up(&mut self, b: Button) -> bool {
        match self.active.remove(&b) {
            None | Some(Active::Pass) => false,
            Some(Active::Held(a)) => {
                self.release(&a);
                true
            }
            Some(Active::TapHold { tap, hold, holding, .. }) => {
                if holding {
                    self.release(&hold);
                } else {
                    self.tap(&tap);
                }
                true
            }
            Some(Active::Gesture { g, fired, native, .. }) => {
                if !fired {
                    let t = g.tap.clone().unwrap_or(native);
                    self.tap(&t);
                }
                true
            }
            Some(Active::Chord { action, members }) => {
                self.release(&action);
                for m in members {
                    if m != b && self.active.contains_key(&m) {
                        self.active.insert(m, Active::Consumed);
                    }
                }
                true
            }
            Some(Active::Consumed) => true,
        }
    }

    /// Resolve buffered presses against chords and sequences.
    fn eval_pending(&mut self, now: Instant) {
        loop {
            let Some(first) = self.pending.first() else {
                self.pending_deadline = None;
                return;
            };
            if !first.down {
                let p = self.pending.remove(0);
                self.dispatch_up(p.b);
                continue;
            }
            let first_t = first.t;
            let downs: Vec<Button> = self.pending.iter().filter(|p| p.down).map(|p| p.b).collect();
            let last_down_t = self.pending.iter().rev().find(|p| p.down).map(|p| p.t).unwrap_or(first_t);
            let any_up = self.pending.iter().any(|p| !p.down);
            let mut distinct = downs.clone();
            distinct.sort_by_key(|b| b.name());
            distinct.dedup();
            let distinct_ok = distinct.len() == downs.len();

            // Complete chord: all members down (none released) within the window.
            let chord = self.cfg.chords.iter().find(|c| {
                !any_up
                    && distinct_ok
                    && c.buttons.len() == downs.len()
                    && c.buttons.iter().all(|b| downs.contains(b))
                    && last_down_t.duration_since(first_t) <= Duration::from_millis(c.ms)
            });
            if let Some(c) = chord {
                let action = c.action.clone();
                self.pending.clear();
                self.press(&action);
                for m in &downs {
                    self.active.insert(*m, Active::Chord { action: action.clone(), members: downs.clone() });
                }
                continue;
            }

            // Complete sequence.
            if let Some(s) = self.cfg.sequences.iter().find(|s| s.buttons == downs) {
                let action = s.action.clone();
                let still_down: Vec<Button> = downs
                    .iter()
                    .copied()
                    .filter(|b| self.pending.iter().rev().find(|p| p.b == *b).map(|p| p.down) == Some(true))
                    .collect();
                self.pending.clear();
                self.tap(&action);
                for b in still_down {
                    self.active.insert(b, Active::Consumed);
                }
                continue;
            }

            // Could this still become a chord or sequence? Wait until the latest deadline.
            let chord_deadline = self
                .cfg
                .chords
                .iter()
                .filter(|c| !any_up && distinct_ok && downs.iter().all(|b| c.buttons.contains(b)))
                .map(|c| first_t + Duration::from_millis(c.ms))
                .max();
            let seq_deadline = self
                .cfg
                .sequences
                .iter()
                .filter(|s| downs.len() < s.buttons.len() && s.buttons.starts_with(&downs))
                .map(|s| last_down_t + Duration::from_millis(s.ms))
                .max();
            if let Some(d) = chord_deadline.max(seq_deadline)
                && d > now
            {
                self.pending_deadline = Some(d);
                return;
            }

            // No: replay the oldest event normally and look at the rest again.
            let p = self.pending.remove(0);
            self.dispatch_down(p.b, true, now);
        }
    }

    pub fn on_timer(&mut self, now: Instant) {
        let due: Vec<Button> = self
            .active
            .iter()
            .filter(|(_, a)| matches!(a, Active::TapHold { deadline, holding: false, .. } if *deadline <= now))
            .map(|(b, _)| *b)
            .collect();
        for b in due {
            self.start_hold(b);
        }
        if self.pending_deadline.is_some_and(|d| d <= now) {
            self.eval_pending(now);
        }
    }

    pub fn on_motion(&mut self, dx: f64, dy: f64) -> Motion {
        let gestures: Vec<Button> = self
            .active
            .iter()
            .filter(|(_, a)| matches!(a, Active::Gesture { .. }))
            .map(|(b, _)| *b)
            .collect();
        if !gestures.is_empty() {
            let mut fire = vec![];
            for b in gestures {
                if let Some(Active::Gesture { g, dx: ax, dy: ay, fired, .. }) = self.active.get_mut(&b) {
                    *ax += dx;
                    *ay += dy;
                    if ax.abs().max(ay.abs()) >= g.threshold {
                        let dir = if ax.abs() >= ay.abs() {
                            if *ax < 0.0 { &g.left } else { &g.right }
                        } else if *ay < 0.0 {
                            &g.up
                        } else {
                            &g.down
                        };
                        if let Some(a) = dir.clone() {
                            fire.push(a);
                        }
                        *fired = true;
                        *ax = 0.0;
                        *ay = 0.0;
                    }
                }
            }
            for a in fire {
                self.tap(&a);
            }
            return Motion::Swallow;
        }
        if let Some(n) = self.out.held_mouse_button() {
            return Motion::Drag(n);
        }
        let swallowed_mouse = self
            .active
            .iter()
            .any(|(b, a)| b.mouse_number().is_some() && !matches!(a, Active::Pass));
        if swallowed_mouse { Motion::Move } else { Motion::Pass }
    }

    /// Returns true if the scroll event should be swallowed.
    pub fn on_scroll(&mut self, dy: f64, dx: f64) -> bool {
        let Some(id) = self.scroll_handler() else { return false };
        match self.call_js(id, vec![dy], dx) {
            None | Some(JsResult::Pass) => false,
            Some(JsResult::Nothing) => true,
            Some(JsResult::Act(a)) => {
                self.tap(&a);
                true
            }
        }
    }

    /// Release every held output. With `keep_tracking`, buttons that are still
    /// physically down get their release swallowed (config reload); otherwise all
    /// tracking is dropped (device gone, exit).
    pub fn release_all(&mut self, keep_tracking: bool) {
        let active = std::mem::take(&mut self.active);
        let mut released_chord = false;
        for (b, a) in active {
            match a {
                Active::Held(x) => self.release(&x),
                Active::TapHold { hold, holding: true, .. } => self.release(&hold),
                Active::Chord { action, .. } if !released_chord => {
                    released_chord = true;
                    self.release(&action);
                }
                Active::Pass => {
                    if keep_tracking {
                        self.active.insert(b, Active::Pass);
                    }
                    continue;
                }
                _ => {}
            }
            if keep_tracking {
                self.active.insert(b, Active::Consumed);
            }
        }
        // Buffered presses whose original event we swallowed: swallow their release too.
        for p in std::mem::take(&mut self.pending) {
            if keep_tracking {
                if p.down {
                    self.active.insert(p.b, Active::Consumed);
                } else {
                    self.active.remove(&p.b);
                }
            }
        }
        self.pending_deadline = None;
        self.layers.clear();
        self.out.release_all();
    }
}

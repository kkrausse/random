//! Synthesized output: keys, modifiers, media keys, mouse buttons, scroll, shell
//! commands. Everything is posted at the HID tap with our private source and tagged
//! with `MAGIC` so our own tap passes it through untouched.

use crate::ffi::*;
use crate::log;
use crate::objc;
use anyhow::{Result, bail};

pub const MAGIC: i64 = 0x5245_4c41_434f_4e; // "RELACON"

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Modifier {
    pub keycode: u16,
    /// Generic mask plus the device-dependent (left/right) bit.
    pub mask: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KeyCombo {
    pub mods: Vec<Modifier>,
    /// `None` for a modifier-only combo like `right_option`.
    pub key: Option<u16>,
    pub spec: String,
}

pub const MOUSE_NAMES: [&str; 5] = ["left", "right", "middle", "back", "forward"];

/// NX key types (IOKit/hidsystem/ev_keymap.h).
pub const NX_SOUND_UP: u8 = 0;
pub const NX_SOUND_DOWN: u8 = 1;
pub const NX_MUTE: u8 = 7;
pub const NX_PLAY: u8 = 16;
pub const NX_NEXT: u8 = 17;
pub const NX_PREVIOUS: u8 = 18;
pub const NX_FAST: u8 = 19;
pub const NX_REWIND: u8 = 20;

pub fn media_code(name: &str) -> Option<u8> {
    Some(match name {
        "play" => NX_PLAY,
        "next" => NX_NEXT,
        "prev" => NX_PREVIOUS,
        "volUp" => NX_SOUND_UP,
        "volDown" => NX_SOUND_DOWN,
        "mute" => NX_MUTE,
        "fast" => NX_FAST,
        "rewind" => NX_REWIND,
        _ => return None,
    })
}

fn modifier(name: &str) -> Option<Modifier> {
    let (keycode, mask) = match name {
        "cmd" | "command" | "left_command" | "left_cmd" => (55, kCGEventFlagMaskCommand | 0x08),
        "right_command" | "right_cmd" => (54, kCGEventFlagMaskCommand | 0x10),
        "shift" | "left_shift" => (56, kCGEventFlagMaskShift | 0x02),
        "right_shift" => (60, kCGEventFlagMaskShift | 0x04),
        "ctrl" | "control" | "left_control" | "left_ctrl" => (59, kCGEventFlagMaskControl | 0x01),
        "right_control" | "right_ctrl" => (62, kCGEventFlagMaskControl | 0x2000),
        "opt" | "option" | "alt" | "left_option" | "left_alt" => (58, kCGEventFlagMaskAlternate | 0x20),
        "right_option" | "right_alt" => (61, kCGEventFlagMaskAlternate | 0x40),
        "fn" => (63, kCGEventFlagMaskSecondaryFn),
        _ => return None,
    };
    Some(Modifier { keycode, mask })
}

/// ANSI virtual keycodes (HIToolbox/Events.h).
fn keycode(name: &str) -> Option<u16> {
    Some(match name {
        "a" => 0, "s" => 1, "d" => 2, "f" => 3, "h" => 4, "g" => 5, "z" => 6, "x" => 7,
        "c" => 8, "v" => 9, "b" => 11, "q" => 12, "w" => 13, "e" => 14, "r" => 15,
        "y" => 16, "t" => 17, "1" => 18, "2" => 19, "3" => 20, "4" => 21, "6" => 22,
        "5" => 23, "=" | "equal" => 24, "9" => 25, "7" => 26, "-" | "minus" => 27, "8" => 28,
        "0" => 29, "]" | "right_bracket" => 30, "o" => 31, "u" => 32, "[" | "left_bracket" => 33,
        "i" => 34, "p" => 35, "return" | "enter" => 36, "l" => 37, "j" => 38,
        "'" | "quote" => 39, "k" => 40, ";" | "semicolon" => 41, "\\" | "backslash" => 42,
        "," | "comma" => 43, "/" | "slash" => 44, "n" => 45, "m" => 46, "." | "period" => 47,
        "tab" => 48, "space" => 49, "`" | "grave" => 50, "delete" | "backspace" => 51,
        "escape" | "esc" => 53, "caps_lock" => 57,
        "f17" => 64, "f18" => 79, "f19" => 80, "f20" => 90,
        "f5" => 96, "f6" => 97, "f7" => 98, "f3" => 99, "f8" => 100, "f9" => 101,
        "f11" => 103, "f13" => 105, "f16" => 106, "f14" => 107, "f10" => 109, "f12" => 111,
        "f15" => 113, "help" => 114, "home" => 115, "page_up" => 116,
        "forward_delete" => 117, "f4" => 118, "end" => 119, "f2" => 120, "page_down" => 121,
        "f1" => 122, "left" => 123, "right" => 124, "down" => 125, "up" => 126,
        _ => return None,
    })
}

/// Parse `"cmd+shift+k"`, `"right_option"`, `"ctrl+left"`.
pub fn parse_key(spec: &str) -> Result<KeyCombo> {
    let parts: Vec<String> = spec.split('+').map(|p| p.trim().to_lowercase()).collect();
    if parts.iter().any(|p| p.is_empty()) {
        bail!("bad key spec {spec:?}");
    }
    let mut mods = Vec::new();
    let mut key = None;
    for (i, p) in parts.iter().enumerate() {
        let last = i == parts.len() - 1;
        if let Some(m) = modifier(p) {
            if !last || key.is_none() {
                mods.push(m);
                continue;
            }
        }
        if !last {
            bail!("{p:?} in {spec:?} is not a modifier (modifiers go before the key)");
        }
        key = Some(keycode(p).ok_or_else(|| anyhow::anyhow!("unknown key {p:?} in {spec:?}"))?);
    }
    Ok(KeyCombo { mods, key, spec: spec.to_string() })
}

/// Output state: our event source plus everything we currently hold down, so a
/// reload / disconnect / exit can release it all.
pub struct Output {
    source: CGEventSourceRef,
    held_mods: Vec<Modifier>,
    held_keys: Vec<u16>,
    held_mouse: Vec<u8>,
    held_media: Vec<u8>,
}

impl Output {
    pub fn new() -> Output {
        let source = unsafe { CGEventSourceCreate(kCGEventSourceStatePrivate) };
        Output { source, held_mods: vec![], held_keys: vec![], held_mouse: vec![], held_media: vec![] }
    }

    fn mod_flags(&self) -> u64 {
        self.held_mods.iter().fold(0, |acc, m| acc | m.mask)
    }

    fn post(&self, ev: CGEventRef) {
        if ev.is_null() {
            log!("failed to create event");
            return;
        }
        unsafe {
            CGEventSetIntegerValueField(ev, kCGEventSourceUserData, MAGIC);
            CGEventPost(kCGHIDEventTap, ev);
            core_foundation_sys::base::CFRelease(ev as _);
        }
    }

    fn flags_changed(&self, keycode: u16) {
        unsafe {
            let ev = CGEventCreateKeyboardEvent(self.source, keycode, true);
            if ev.is_null() {
                return;
            }
            CGEventSetType(ev, kCGEventFlagsChanged);
            CGEventSetFlags(ev, self.mod_flags() | kCGEventFlagMaskNonCoalesced);
            self.post(ev);
        }
    }

    pub fn mod_down(&mut self, m: Modifier) {
        let already = self.held_mods.contains(&m);
        self.held_mods.push(m);
        if !already {
            self.flags_changed(m.keycode);
        }
    }

    pub fn mod_up(&mut self, m: Modifier) {
        if let Some(i) = self.held_mods.iter().position(|h| *h == m) {
            self.held_mods.remove(i);
            if !self.held_mods.contains(&m) {
                self.flags_changed(m.keycode);
            }
        }
    }

    fn key_event(&mut self, keycode: u16, down: bool) {
        if down {
            self.held_keys.push(keycode);
        } else if let Some(i) = self.held_keys.iter().position(|k| *k == keycode) {
            self.held_keys.remove(i);
        }
        unsafe {
            let ev = CGEventCreateKeyboardEvent(self.source, keycode, down);
            if ev.is_null() {
                return;
            }
            CGEventSetFlags(ev, self.mod_flags() | kCGEventFlagMaskNonCoalesced);
            self.post(ev);
        }
    }

    pub fn key_down(&mut self, k: &KeyCombo) {
        for m in &k.mods {
            self.mod_down(*m);
        }
        if let Some(code) = k.key {
            self.key_event(code, true);
        }
    }

    pub fn key_up(&mut self, k: &KeyCombo) {
        if let Some(code) = k.key {
            self.key_event(code, false);
        }
        for m in k.mods.iter().rev() {
            self.mod_up(*m);
        }
    }

    pub fn media(&mut self, code: u8, down: bool) {
        if down {
            self.held_media.push(code);
        } else if let Some(i) = self.held_media.iter().position(|c| *c == code) {
            self.held_media.remove(i);
        }
        if let Some(ev) = objc::media_key_event(code, down) {
            unsafe {
                CGEventSetIntegerValueField(ev, kCGEventSourceUserData, MAGIC);
                CGEventPost(kCGHIDEventTap, ev);
                core_foundation_sys::base::CFRelease(ev as _);
            }
        }
    }

    /// Mouse button currently held by us, if any (lowest number first), so the tap can
    /// turn pointer motion into drags.
    pub fn held_mouse_button(&self) -> Option<u8> {
        self.held_mouse.iter().min().copied()
    }

    pub fn mouse(&mut self, button: u8, down: bool) {
        if down {
            self.held_mouse.push(button);
        } else if let Some(i) = self.held_mouse.iter().position(|b| *b == button) {
            self.held_mouse.remove(i);
        }
        let ty = match (button, down) {
            (0, true) => kCGEventLeftMouseDown,
            (0, false) => kCGEventLeftMouseUp,
            (1, true) => kCGEventRightMouseDown,
            (1, false) => kCGEventRightMouseUp,
            (_, true) => kCGEventOtherMouseDown,
            (_, false) => kCGEventOtherMouseUp,
        };
        unsafe {
            let here = CGEventCreate(std::ptr::null_mut());
            let loc = if here.is_null() { CGPoint::default() } else { CGEventGetLocation(here) };
            if !here.is_null() {
                core_foundation_sys::base::CFRelease(here as _);
            }
            let ev = CGEventCreateMouseEvent(self.source, ty, loc, button as u32);
            if ev.is_null() {
                return;
            }
            CGEventSetIntegerValueField(ev, kCGMouseEventButtonNumber, button as i64);
            CGEventSetIntegerValueField(ev, kCGMouseEventClickState, 1);
            CGEventSetFlags(ev, self.mod_flags());
            self.post(ev);
        }
    }

    pub fn scroll(&mut self, dy: i32, dx: i32) {
        unsafe {
            let ev = CGEventCreateScrollWheelEvent2(self.source, kCGScrollEventUnitLine, 2, dy, dx, 0);
            if !ev.is_null() {
                CGEventSetFlags(ev, self.mod_flags());
            }
            self.post(ev);
        }
    }

    pub fn run(&mut self, cmd: &str) {
        log!("run: {cmd}");
        match std::process::Command::new("/bin/sh")
            .arg("-c")
            .arg(cmd)
            .stdin(std::process::Stdio::null())
            .spawn()
        {
            // Reap it off-thread so we don't collect zombies.
            Ok(mut child) => {
                std::thread::spawn(move || child.wait());
            }
            Err(e) => log!("run failed: {e}"),
        }
    }

    /// Release everything we still hold. Called on reload, disconnect and exit.
    pub fn release_all(&mut self) {
        for k in std::mem::take(&mut self.held_keys) {
            self.key_event(k, false);
        }
        for b in std::mem::take(&mut self.held_mouse) {
            self.mouse(b, false);
        }
        for c in std::mem::take(&mut self.held_media) {
            self.media(c, false);
        }
        let mods = std::mem::take(&mut self.held_mods);
        let mut seen: Vec<Modifier> = vec![];
        for m in mods {
            if !seen.contains(&m) {
                seen.push(m);
            }
        }
        // Release one at a time so each flagsChanged carries the remaining flags.
        self.held_mods = seen.clone();
        for m in seen.into_iter().rev() {
            self.mod_up(m);
        }
    }
}

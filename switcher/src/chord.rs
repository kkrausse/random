//! "Tap Cmd, then hold right Option" opens the popover.
//!
//! Right Option held alone is the dictation app's push-to-talk key, and it
//! only starts dictating when no other modifier is down. So the way to say
//! "dictate into the switcher" can't be a chord with right Option in it; it is
//! a leader tap first, like the remote's leader-then-hold. The dictation app
//! sees its ordinary key, we open on the same key-down, and what is dictated
//! is typed into the search box.
//!
//! Modifier changes are watched with a global NSEvent monitor, which needs no
//! Accessibility or Input Monitoring permission for `flagsChanged`. Ordinary
//! key presses are not visible to it, so Cmd+C pressed and released quickly
//! also counts as a tap; the short windows below keep that from mattering.

use std::cell::Cell;
use std::ptr::NonNull;
use std::time::{Duration, Instant};

use block2::RcBlock;
use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags};

/// Longest Cmd press that still counts as a tap.
const TAP_MAX: Duration = Duration::from_millis(300);
/// Shortest one. The dictation app pastes with a synthetic Cmd press whose
/// down and up arrive together; without this floor, dictating twice in quick
/// succession would look like the gesture.
const TAP_MIN: Duration = Duration::from_millis(20);
/// How long after the tap right Option may go down.
const LEADER: Duration = Duration::from_millis(600);

const LEFT_COMMAND: u16 = 55;
const RIGHT_COMMAND: u16 = 54;
const RIGHT_OPTION: u16 = 61;

#[derive(Clone, Copy, Default)]
struct State {
    command_down_at: Option<Instant>,
    tapped_at: Option<Instant>,
}

/// One modifier change: the key that changed and what is held afterwards.
#[derive(Clone, Copy, Debug)]
struct Change {
    key: u16,
    command: bool,
    option: bool,
    /// Control or Shift.
    other: bool,
    at: Instant,
}

/// Advances the sequence; true when the gesture has just been completed.
fn step(previous: State, change: Change) -> (State, bool) {
    let Change {
        key,
        command,
        option,
        other,
        at,
    } = change;
    let within = |start: Option<Instant>, limit| start.is_some_and(|start| at - start < limit);
    let mut next = State::default();
    let mut fired = false;
    match key {
        LEFT_COMMAND | RIGHT_COMMAND if command && !option && !other => {
            next.command_down_at = Some(at);
        }
        LEFT_COMMAND | RIGHT_COMMAND if !command && !option && !other => {
            if within(previous.command_down_at, TAP_MAX)
                && !within(previous.command_down_at, TAP_MIN)
            {
                next.tapped_at = Some(at);
            }
        }
        RIGHT_OPTION if option && !command && !other => {
            fired = within(previous.tapped_at, LEADER);
        }
        // Any other modifier activity breaks the sequence.
        _ => {}
    }
    (next, fired)
}

/// Calls `on_chord` on the main thread each time the gesture is made.
pub fn watch(on_chord: impl Fn() + 'static) {
    let state = Cell::new(State::default());
    let seen = Cell::new(false);
    // `SWITCHER_LOG_CHORD=1` prints every modifier change, to check key codes
    // and timing against a particular keyboard.
    let log = std::env::var_os("SWITCHER_LOG_CHORD").is_some();
    let handler = RcBlock::new(move |event: NonNull<NSEvent>| {
        // SAFETY: AppKit passes a live event for the duration of the call.
        let event = unsafe { event.as_ref() };
        if !seen.replace(true) {
            eprintln!("switcher: seeing modifier keys (Cmd tap, then right Option, opens)");
        }
        let flags = event.modifierFlags();
        let held = |flag| flags.contains(flag);
        let change = Change {
            key: event.keyCode(),
            command: held(NSEventModifierFlags::Command),
            option: held(NSEventModifierFlags::Option),
            other: held(NSEventModifierFlags::Control) || held(NSEventModifierFlags::Shift),
            at: Instant::now(),
        };
        let (next, fired) = step(state.get(), change);
        state.set(next);
        if log {
            eprintln!("switcher: chord {change:?} -> fired {fired}");
        }
        if fired {
            on_chord();
        }
    });
    let monitor =
        NSEvent::addGlobalMonitorForEventsMatchingMask_handler(NSEventMask::FlagsChanged, &handler);
    if monitor.is_none() {
        eprintln!("switcher: cannot watch modifier keys; Cmd tap + right Option is off");
    }
    // Watched for the life of the process.
    std::mem::forget(monitor);
}

#[cfg(test)]
mod tests {
    use super::*;

    // Kept because of a false positive seen in real key logs: the dictation
    // app's paste arrives as a Cmd press with down and up together, which
    // read as a tap. Times are milliseconds; columns are key, Cmd, Option.
    fn run(changes: &[(u64, u16, bool, bool)]) -> Vec<bool> {
        let start = Instant::now();
        let mut state = State::default();
        changes
            .iter()
            .map(|&(ms, key, command, option)| {
                let (next, fired) = step(
                    state,
                    Change {
                        key,
                        command,
                        option,
                        other: false,
                        at: start + Duration::from_millis(ms),
                    },
                );
                state = next;
                fired
            })
            .collect()
    }

    #[test]
    fn gesture() {
        // Cmd tap, then right Option: opens on the Option key-down.
        assert_eq!(
            run(&[(0, 55, true, false), (80, 55, false, false), (250, 61, false, true)]),
            [false, false, true]
        );
        // Right Option alone (plain dictation): never.
        assert_eq!(run(&[(0, 61, false, true), (500, 61, false, false)]), [false, false]);
        // Cmd held too long is not a tap.
        assert_eq!(
            run(&[(0, 55, true, false), (400, 55, false, false), (500, 61, false, true)]),
            [false, false, false]
        );
        // Right Option after the leader window.
        assert_eq!(
            run(&[(0, 55, true, false), (80, 55, false, false), (800, 61, false, true)]),
            [false, false, false]
        );
        // Cmd still down when right Option goes down (the old chord): no.
        assert_eq!(run(&[(0, 55, true, false), (100, 61, true, true)]), [false, false]);
        // A synthetic Cmd press (down and up together), then right Option: no.
        assert_eq!(
            run(&[(0, 55, true, false), (0, 55, false, false), (200, 61, false, true)]),
            [false, false, false]
        );
        // Releasing right Option after a later Cmd tap does not open.
        assert_eq!(
            run(&[
                (0, 61, false, true),
                (300, 55, true, true),
                (350, 55, false, true),
                (400, 61, false, false)
            ]),
            [false, false, false, false]
        );
    }
}

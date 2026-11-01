//! relacon-d: remaps the ELECOM Relacon trackball on macOS. See DESIGN.md.
//!
//! Everything runs on the main thread's CFRunLoop: the event tap, IOHIDManager
//! callbacks, timers, FSEvents and QuickJS. State lives in one thread-local.
#![allow(non_upper_case_globals)]

mod config;
mod engine;
mod ffi;
mod hid;
mod log;
mod objc;
mod output;

use config::Button;
use core_foundation::array::CFArray;
use core_foundation::base::TCFType;
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::CFString;
use core_foundation_sys::date::CFAbsoluteTimeGetCurrent;
use core_foundation_sys::mach_port::{CFMachPortCreateRunLoopSource, CFMachPortRef};
use core_foundation_sys::runloop::*;
use engine::{Engine, Motion};
use ffi::*;
use hid::Hid;
use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::ffi::{CStr, c_char, c_void};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

const RELOAD_NOTIFICATION: &str = "com.kkrausse.relacon-d.reload";
const FAR_FUTURE: f64 = 1.0e10;

#[derive(PartialEq, Clone, Copy)]
enum Mode {
    Run,
    Events { motion: bool, suppress: bool },
}

#[derive(Default)]
struct MotionStats {
    n: usize,
    sender: usize,
    hid: usize,
    neither: usize,
    senders: HashMap<u64, usize>,
}

struct Daemon {
    mode: Mode,
    engine: Engine,
    hid: Hid,
    hid_open: bool,
    tap: CFMachPortRef,
    engine_timer: CFRunLoopTimerRef,
    reload_timer: CFRunLoopTimerRef,
    config_path: PathBuf,
    stream: FSEventStreamRef,
    watched: Vec<PathBuf>,
    /// Input classes for which a sender-ID match has been seen: from then on, the
    /// sender ID alone decides.
    sender_works: HashSet<&'static str>,
    /// Buttons whose press we attributed to the Relacon (their release follows).
    owned: HashSet<Button>,
    logged_methods: HashSet<(&'static str, &'static str)>,
    motion: MotionStats,
    last_retry: Instant,
}

thread_local! {
    static DAEMON: RefCell<Option<Daemon>> = const { RefCell::new(None) };
    static TAP: Cell<CFMachPortRef> = const { Cell::new(std::ptr::null_mut()) };
}
static TERMINATE: AtomicBool = AtomicBool::new(false);

/// Run `f` against the daemon state. Returns None if not initialised or re-entered.
fn with<R>(f: impl FnOnce(&mut Daemon) -> R) -> Option<R> {
    DAEMON.with(|d| {
        let mut d = d.try_borrow_mut().ok()?;
        d.as_mut().map(f)
    })
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(String::as_str).unwrap_or("help");
    let flag = |f: &str| args.iter().any(|a| a == f);
    match cmd {
        "run" => start(Mode::Run),
        "events" => start(Mode::Events { motion: flag("--motion"), suppress: flag("--suppress") }),
        "check" => {
            let path = args.iter().skip(1).find(|a| !a.starts_with("--")).map(PathBuf::from);
            std::process::exit(check(&path.unwrap_or_else(default_config_path), flag("--call")));
        }
        "reload" => {
            post_reload();
            println!("sent reload to the running daemon ({RELOAD_NOTIFICATION})");
        }
        _ => {
            println!(
                "relacon-d: ELECOM Relacon remapper\n\n\
                 usage:\n  \
                 relacon-d run                  run the daemon (what the LaunchAgent starts)\n  \
                 relacon-d events [--motion] [--suppress]\n                                 \
                 print attributed raw events from the Relacon\n  \
                 relacon-d check [path] [--call] load + validate a config without applying it\n                                 \
                 (--call: also run each function once, sending nothing)\n  \
                 relacon-d reload               nudge the running daemon to reload its config\n\n\
                 config: {} (override with RELACON_CONFIG)\n\
                 log:    ~/Library/Logs/relacon-d.log",
                default_config_path().display()
            );
        }
    }
}

fn default_config_path() -> PathBuf {
    if let Ok(p) = std::env::var("RELACON_CONFIG") {
        return PathBuf::from(p);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    Path::new(&home).join(".config/relacon/config.ts")
}

fn check(path: &Path, call: bool) -> i32 {
    match config::load(path) {
        Ok(cfg) => {
            let files: Vec<String> = cfg.files.iter().map(|f| f.display().to_string()).collect();
            println!("ok: {}", files.join(" + "));
            print!("{}", cfg.summary());
            if call && let Some(js) = &cfg.js {
                // Smoke-test every function once (scroll handlers get dy = 1); nothing is sent.
                let app = objc::frontmost_app();
                let scroll_fns: HashSet<usize> = std::iter::once(&cfg.base)
                    .chain(cfg.layers.values())
                    .chain(cfg.apps.values())
                    .filter_map(|b| b.scroll)
                    .collect();
                let mut failed = false;
                for id in 0..js.fn_count() {
                    let args = if scroll_fns.contains(&id) { vec![1.0] } else { vec![] };
                    let r = js.call(id, config::JsCall { args, app: &app, layers: &[], dx: 0.0 });
                    let sent: Vec<String> = config::take_outbox().iter().map(config::describe).collect();
                    let sent = if sent.is_empty() { String::new() } else { format!("  sent: {}", sent.join(", ")) };
                    match r {
                        Ok(config::JsResult::Nothing) => println!("  fn #{id}: returned nothing{sent}"),
                        Ok(config::JsResult::Pass) => println!("  fn #{id}: \"pass\"{sent}"),
                        Ok(config::JsResult::Act(a)) => println!("  fn #{id}: {}{sent}", config::describe(&a)),
                        Err(e) => {
                            failed = true;
                            println!("  fn #{id}: error: {e:#}");
                        }
                    }
                }
                if failed {
                    return 1;
                }
            }
            0
        }
        Err(e) => {
            eprintln!("error: {e:#}");
            1
        }
    }
}

fn post_reload() {
    use core_foundation_sys::notification_center::*;
    let name = CFString::new(RELOAD_NOTIFICATION);
    unsafe {
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            name.as_concrete_TypeRef(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        );
    }
}

// ------------------------------------------------------------------ startup

extern "C" fn on_signal(_: libc::c_int) {
    TERMINATE.store(true, Ordering::SeqCst);
}

fn start(mode: Mode) {
    unsafe {
        libc::signal(libc::SIGTERM, on_signal as *const () as libc::sighandler_t);
        libc::signal(libc::SIGINT, on_signal as *const () as libc::sighandler_t);
        libc::signal(libc::SIGHUP, on_signal as *const () as libc::sighandler_t);
    }
    log!("relacon-d {} starting ({})", env!("CARGO_PKG_VERSION"), if mode == Mode::Run { "run" } else { "events" });
    check_permissions(mode);

    let config_path = default_config_path();
    let cfg = if mode == Mode::Run { initial_config(&config_path) } else { config::Config::empty() };

    let daemon = Daemon {
        mode,
        engine: Engine::new(cfg),
        hid: Hid::default(),
        hid_open: false,
        tap: std::ptr::null_mut(),
        engine_timer: make_timer(FAR_FUTURE, engine_timer_cb),
        reload_timer: make_timer(FAR_FUTURE, reload_timer_cb),
        config_path,
        stream: std::ptr::null_mut(),
        watched: vec![],
        sender_works: HashSet::new(),
        owned: HashSet::new(),
        logged_methods: HashSet::new(),
        motion: MotionStats::default(),
        last_retry: Instant::now(),
    };
    DAEMON.with(|d| *d.borrow_mut() = Some(daemon));

    // HID manager: open outside of any borrow (callbacks may fire during open).
    let manager = hid::create_manager(hid_match_cb, hid_remove_cb, hid_value_cb);
    with(|d| d.hid.manager = Some(manager));
    open_hid();
    with(|d| d.ensure_tap());

    // Poll timer: termination, permission retries, motion stats.
    let poll = make_timer(0.25, poll_timer_cb);
    unsafe { CFRunLoopTimerSetNextFireDate(poll, CFAbsoluteTimeGetCurrent() + 0.25) };

    if mode == Mode::Run {
        with(|d| d.watch());
        observe_reload_notification();
    } else {
        println!("listening; press Relacon buttons (Ctrl-C to quit)");
        if let Mode::Events { suppress: true, .. } = mode {
            println!("--suppress: attributed Relacon events are swallowed (proves suppression)");
        }
    }
    unsafe { CFRunLoopRun() };
}

fn initial_config(path: &Path) -> config::Config {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if !path.exists() {
        log!("no config at {}; everything passes through until one appears", path.display());
        return config::Config::empty();
    }
    match config::load(path) {
        Ok(cfg) => {
            log!("loaded {}\n{}", path.display(), cfg.summary().trim_end());
            cfg
        }
        Err(e) => {
            log!("config error: {e:#}");
            log::notify("relacon-d: config error", &format!("{e:#}"));
            config::Config::empty()
        }
    }
}

fn check_permissions(mode: Mode) {
    let need_ax = matches!(mode, Mode::Run | Mode::Events { suppress: true, .. });
    unsafe {
        let access = IOHIDCheckAccess(kIOHIDRequestTypeListenEvent);
        if access != kIOHIDAccessTypeGranted {
            log!(
                "Input Monitoring not granted (state {access}); requesting. Enable Relacon (or your terminal) in \
                 System Settings > Privacy & Security > Input Monitoring"
            );
            IOHIDRequestAccess(kIOHIDRequestTypeListenEvent);
        }
        if need_ax {
            let key = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt);
            let opts = CFDictionary::from_CFType_pairs(&[(key, CFBoolean::true_value())]);
            if !AXIsProcessTrustedWithOptions(opts.as_concrete_TypeRef() as _) {
                log!(
                    "Accessibility not granted; requested. Enable Relacon (or your terminal) in \
                     System Settings > Privacy & Security > Accessibility"
                );
            }
        }
    }
}

fn open_hid() {
    let Some(manager) = with(|d| d.hid.manager).flatten() else { return };
    let r = unsafe { IOHIDManagerOpen(manager, kIOHIDOptionsTypeNone) };
    if r == kIOReturnSuccess {
        with(|d| d.hid_open = true);
        log!("IOHIDManager open; waiting for the Relacon ({}:{})", hid::VENDOR_ID, hid::PRODUCT_ID);
    } else {
        log!("IOHIDManagerOpen failed ({r:#x}); Input Monitoring missing? retrying");
    }
}

fn make_timer(interval: f64, cb: extern "C" fn(CFRunLoopTimerRef, *mut c_void)) -> CFRunLoopTimerRef {
    unsafe {
        // Repeating with a huge interval so we can re-arm it with SetNextFireDate
        // (a one-shot timer is invalidated after it fires).
        let interval = if interval >= FAR_FUTURE { FAR_FUTURE } else { interval };
        let t = CFRunLoopTimerCreate(
            std::ptr::null(),
            CFAbsoluteTimeGetCurrent() + FAR_FUTURE,
            interval,
            0,
            0,
            cb,
            std::ptr::null_mut(),
        );
        CFRunLoopAddTimer(CFRunLoopGetCurrent(), t, kCFRunLoopCommonModes);
        t
    }
}

fn arm(timer: CFRunLoopTimerRef, after: Duration) {
    unsafe { CFRunLoopTimerSetNextFireDate(timer, CFAbsoluteTimeGetCurrent() + after.as_secs_f64()) };
}

fn observe_reload_notification() {
    use core_foundation_sys::notification_center::*;
    extern "C" fn cb(
        _: CFNotificationCenterRef,
        _: *mut c_void,
        _: CFNotificationName,
        _: *const c_void,
        _: core_foundation_sys::dictionary::CFDictionaryRef,
    ) {
        log!("reload requested");
        with(|d| arm(d.reload_timer, Duration::ZERO));
    }
    let name = CFString::new(RELOAD_NOTIFICATION);
    unsafe {
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            std::ptr::null(),
            cb,
            name.as_concrete_TypeRef(),
            std::ptr::null(),
            CFNotificationSuspensionBehaviorDeliverImmediately,
        );
    }
}

// ------------------------------------------------------------------ callbacks

extern "C" fn tap_cb(_proxy: CGEventTapProxy, ty: u32, ev: CGEventRef, _refcon: *mut c_void) -> CGEventRef {
    if ty == kCGEventTapDisabledByTimeout || ty == kCGEventTapDisabledByUserInput {
        log!("event tap was disabled by macOS ({ty:#x}); re-enabling");
        let tap = TAP.with(|t| t.get());
        if !tap.is_null() {
            unsafe { CGEventTapEnable(tap, true) };
        }
        return ev;
    }
    if unsafe { CGEventGetIntegerValueField(ev, kCGEventSourceUserData) } == output::MAGIC {
        return ev;
    }
    let swallow = with(|d| d.on_event(ty, ev)).unwrap_or(false);
    if swallow { std::ptr::null_mut() } else { ev }
}

extern "C" fn hid_match_cb(_: *mut c_void, _: IOReturn, _: *mut c_void, device: IOHIDDeviceRef) {
    with(|d| {
        if d.hid.devices.iter().any(|x| x.dev == device) {
            return;
        }
        let dev = hid::device_info(device);
        log!("Relacon connected: {} ({} IOService registry IDs)", dev.name, dev.ids.len());
        for n in &dev.id_names {
            log!("    {n}");
        }
        d.hid.devices.push(dev);
    });
}

extern "C" fn hid_remove_cb(_: *mut c_void, _: IOReturn, _: *mut c_void, device: IOHIDDeviceRef) {
    with(|d| {
        d.hid.devices.retain(|x| x.dev != device);
        log!("Relacon disconnected");
        if d.hid.devices.is_empty() {
            d.engine.release_all(false);
            d.owned.clear();
            d.reschedule();
        }
    });
}

extern "C" fn hid_value_cb(_: *mut c_void, _: IOReturn, _: *mut c_void, value: IOHIDValueRef) {
    let (page, usage, val, ts) = unsafe {
        let el = IOHIDValueGetElement(value);
        (
            IOHIDElementGetUsagePage(el),
            IOHIDElementGetUsage(el),
            IOHIDValueGetIntegerValue(value) as i64,
            mach_to_ns(IOHIDValueGetTimeStamp(value)),
        )
    };
    with(|d| {
        d.hid.last.insert((page, usage), (val, ts));
        if let Mode::Events { motion, .. } = d.mode {
            let is_motion = hid::MOTION_USAGES.contains(&(page, usage));
            let is_axis = is_motion || hid::SCROLL_USAGES.contains(&(page, usage));
            if (is_motion && !motion) || (is_axis && val == 0) {
                return;
            }
            let name = hid::usage_name(page, usage);
            let button = hid::button_for_usage(page, usage).map(|b| format!(" -> {}", b.name())).unwrap_or_default();
            println!(
                "{}  hid   page={page:#06x} usage={usage:#06x} value={val:<4} {name}{button}",
                log::timestamp()
            );
        }
    });
}

extern "C" fn engine_timer_cb(_: CFRunLoopTimerRef, _: *mut c_void) {
    with(|d| {
        d.engine.on_timer(Instant::now());
        d.reschedule();
    });
}

extern "C" fn reload_timer_cb(t: CFRunLoopTimerRef, _: *mut c_void) {
    unsafe { CFRunLoopTimerSetNextFireDate(t, CFAbsoluteTimeGetCurrent() + FAR_FUTURE) };
    with(|d| d.reload());
}

extern "C" fn poll_timer_cb(_: CFRunLoopTimerRef, _: *mut c_void) {
    if TERMINATE.load(Ordering::SeqCst) {
        with(|d| d.engine.release_all(false));
        log!("relacon-d exiting");
        std::process::exit(0);
    }
    let retry = with(|d| {
        let due = d.last_retry.elapsed() > Duration::from_secs(3);
        if due {
            d.last_retry = Instant::now();
            d.ensure_tap();
        }
        due && !d.hid_open
    })
    .unwrap_or(false);
    if retry {
        open_hid();
    }
    with(|d| d.print_motion_stats());
}

extern "C" fn fsevents_cb(
    _: FSEventStreamRef,
    _: *mut c_void,
    n: usize,
    paths: *mut c_void,
    _: *const u32,
    _: *const u64,
) {
    let paths = paths as *const *const c_char;
    let relevant = (0..n).any(|i| {
        let p = unsafe { CStr::from_ptr(*paths.add(i)) }.to_string_lossy();
        p.ends_with(".ts")
    });
    if relevant {
        with(|d| arm(d.reload_timer, Duration::from_millis(100)));
    }
}

// ------------------------------------------------------------------ daemon

fn media_button(code: u8) -> Option<Button> {
    use output::*;
    Some(match code {
        NX_SOUND_UP => Button::VolUp,
        NX_SOUND_DOWN => Button::VolDown,
        NX_PLAY => Button::Play,
        NX_NEXT | NX_FAST => Button::Next,
        NX_PREVIOUS | NX_REWIND => Button::Prev,
        _ => return None,
    })
}

fn type_name(ty: u32) -> &'static str {
    match ty {
        kCGEventLeftMouseDown => "leftMouseDown",
        kCGEventLeftMouseUp => "leftMouseUp",
        kCGEventRightMouseDown => "rightMouseDown",
        kCGEventRightMouseUp => "rightMouseUp",
        kCGEventOtherMouseDown => "otherMouseDown",
        kCGEventOtherMouseUp => "otherMouseUp",
        kCGEventMouseMoved => "mouseMoved",
        kCGEventLeftMouseDragged => "leftMouseDragged",
        kCGEventRightMouseDragged => "rightMouseDragged",
        kCGEventOtherMouseDragged => "otherMouseDragged",
        kCGEventScrollWheel => "scrollWheel",
        NX_SYSDEFINED => "NX_SYSDEFINED",
        _ => "other",
    }
}

fn yn(b: bool) -> &'static str {
    if b { "yes" } else { "no " }
}

impl Daemon {
    fn ensure_tap(&mut self) {
        if !self.tap.is_null() {
            return;
        }
        let listen_only = matches!(self.mode, Mode::Events { suppress: false, .. });
        let mask: u64 = [
            kCGEventLeftMouseDown,
            kCGEventLeftMouseUp,
            kCGEventRightMouseDown,
            kCGEventRightMouseUp,
            kCGEventMouseMoved,
            kCGEventLeftMouseDragged,
            kCGEventRightMouseDragged,
            NX_SYSDEFINED,
            kCGEventScrollWheel,
            kCGEventOtherMouseDown,
            kCGEventOtherMouseUp,
            kCGEventOtherMouseDragged,
        ]
        .iter()
        .fold(0, |m, t| m | (1u64 << t));
        let session = std::env::var("RELACON_TAP").map(|v| v == "session").unwrap_or(false);
        let location = if session { kCGSessionEventTap } else { kCGHIDEventTap };
        let options = if listen_only { kCGEventTapOptionListenOnly } else { kCGEventTapOptionDefault };
        unsafe {
            let port = CGEventTapCreate(location, kCGHeadInsertEventTap, options, mask, tap_cb, std::ptr::null_mut());
            if port.is_null() {
                log!(
                    "could not create the event tap ({}); grant {} and it will start automatically",
                    if session { "session" } else { "HID" },
                    if listen_only { "Input Monitoring" } else { "Accessibility" }
                );
                return;
            }
            let src = CFMachPortCreateRunLoopSource(std::ptr::null(), port, 0);
            CFRunLoopAddSource(CFRunLoopGetCurrent(), src, kCFRunLoopCommonModes);
            CGEventTapEnable(port, true);
            self.tap = port;
            TAP.with(|t| t.set(port));
        }
        log!(
            "event tap installed ({} tap, {})",
            if session { "session" } else { "HID" },
            if listen_only { "listen-only" } else { "active" }
        );
    }

    fn reschedule(&self) {
        let after = match self.engine.next_deadline() {
            Some(d) => d.saturating_duration_since(Instant::now()),
            None => Duration::from_secs_f64(FAR_FUTURE),
        };
        arm(self.engine_timer, after);
    }

    fn decide(&mut self, class: &'static str, sender_match: bool, fallback: bool) -> (bool, &'static str) {
        let r = if sender_match {
            self.sender_works.insert(class);
            (true, "sender-id")
        } else if self.sender_works.contains(class) {
            (false, "sender-mismatch")
        } else if fallback {
            (true, "hid-correlation")
        } else {
            (false, "none")
        };
        if r.0 && self.mode == Mode::Run && self.logged_methods.insert((class, r.1)) {
            log!("attribution: {class} matched via {}", r.1);
        }
        r
    }

    /// Returns true to swallow the event.
    fn on_event(&mut self, ty: u32, ev: CGEventRef) -> bool {
        let sender = unsafe { CGEventGetIntegerValueField(ev, kCGEventSenderID) } as u64;
        let field = |f: u32| unsafe { CGEventGetIntegerValueField(ev, f) };
        match ty {
            kCGEventLeftMouseDown | kCGEventLeftMouseUp | kCGEventRightMouseDown | kCGEventRightMouseUp
            | kCGEventOtherMouseDown | kCGEventOtherMouseUp => {
                let n = match ty {
                    kCGEventLeftMouseDown | kCGEventLeftMouseUp => 0,
                    kCGEventRightMouseDown | kCGEventRightMouseUp => 1,
                    _ => field(kCGMouseEventButtonNumber),
                };
                let down = matches!(ty, kCGEventLeftMouseDown | kCGEventRightMouseDown | kCGEventOtherMouseDown);
                match Button::from_mouse_number(n) {
                    Some(b) => self.button_event(type_name(ty), b, down, false, sender),
                    None => {
                        if self.mode != Mode::Run {
                            println!("{}  {}  button={n} (not a Relacon button) sender={sender:#x}", log::timestamp(), type_name(ty));
                        }
                        false
                    }
                }
            }
            NX_SYSDEFINED => {
                let Some(m) = objc::parse_media(ev) else { return false };
                match media_button(m.code) {
                    Some(b) => self.button_event("media", b, m.down, m.repeat, sender),
                    None => {
                        if self.mode != Mode::Run {
                            println!(
                                "{}  media key code={} {} (not a Relacon button) sender={sender:#x}",
                                log::timestamp(),
                                m.code,
                                if m.down { "down" } else { "up" }
                            );
                        }
                        false
                    }
                }
            }
            kCGEventScrollWheel => {
                let dy = field(kCGScrollWheelEventDeltaAxis1) as f64;
                let dx = field(kCGScrollWheelEventDeltaAxis2) as f64;
                let continuous = field(kCGScrollWheelEventIsContinuous) != 0;
                let sender_match = self.hid.is_relacon_sender(sender);
                let hid_ok = !continuous && self.hid.recent(&hid::SCROLL_USAGES);
                let (ours, how) = self.decide("scroll", sender_match, hid_ok);
                match self.mode {
                    Mode::Events { suppress, .. } => {
                        println!(
                            "{}  scrollWheel      dy={dy:<3} dx={dx:<3} continuous={}  sender={sender:#x} sender-match={} hid={}  => {}",
                            log::timestamp(),
                            yn(continuous),
                            yn(sender_match),
                            yn(hid_ok),
                            if ours { format!("RELACON via {how}") } else { "not relacon".into() }
                        );
                        suppress && ours
                    }
                    Mode::Run => ours && self.engine.on_scroll(dy, dx),
                }
            }
            kCGEventMouseMoved | kCGEventLeftMouseDragged | kCGEventRightMouseDragged | kCGEventOtherMouseDragged => {
                let dx = field(kCGMouseEventDeltaX) as f64;
                let dy = field(kCGMouseEventDeltaY) as f64;
                if let Mode::Events { motion, suppress } = self.mode {
                    let sender_match = self.hid.is_relacon_sender(sender);
                    let hid_ok = self.hid.recent(&hid::MOTION_USAGES);
                    let (ours, how) = self.decide("motion", sender_match, hid_ok);
                    let s = &mut self.motion;
                    s.n += 1;
                    *s.senders.entry(sender).or_default() += 1;
                    if sender_match {
                        s.sender += 1;
                    } else if hid_ok {
                        s.hid += 1;
                    } else {
                        s.neither += 1;
                    }
                    if motion {
                        println!(
                            "{}  {:<17} dx={dx:<4} dy={dy:<4} sender={sender:#x} sender-match={} hid={}  => {}",
                            log::timestamp(),
                            type_name(ty),
                            yn(sender_match),
                            yn(hid_ok),
                            if ours { format!("RELACON via {how}") } else { "not relacon".into() }
                        );
                    }
                    return suppress && ours && motion;
                }
                if !self.engine.wants_motion() {
                    return false;
                }
                let sender_match = self.hid.is_relacon_sender(sender);
                let (ours, _) = self.decide("motion", sender_match, !sender_match && self.hid.recent(&hid::MOTION_USAGES));
                if !ours {
                    return false;
                }
                match self.engine.on_motion(dx, dy) {
                    Motion::Pass => false,
                    Motion::Swallow => {
                        self.reschedule();
                        true
                    }
                    Motion::Drag(n) => {
                        let t = match n {
                            0 => kCGEventLeftMouseDragged,
                            1 => kCGEventRightMouseDragged,
                            _ => kCGEventOtherMouseDragged,
                        };
                        unsafe {
                            CGEventSetType(ev, t);
                            CGEventSetIntegerValueField(ev, kCGMouseEventButtonNumber, n as i64);
                        }
                        false
                    }
                    Motion::Move => {
                        if ty != kCGEventMouseMoved {
                            unsafe { CGEventSetType(ev, kCGEventMouseMoved) };
                        }
                        false
                    }
                }
            }
            _ => false,
        }
    }

    fn button_event(&mut self, kind: &str, b: Button, down: bool, repeat: bool, sender: u64) -> bool {
        let class = if b.mouse_number().is_some() { "mouse buttons" } else { "media keys" };
        let sender_match = self.hid.is_relacon_sender(sender);
        let hid_pressed = self.hid.button_pressed(b);
        // Fallback: a press needs the Relacon's HID state to agree; a release follows
        // the attribution of its press.
        let fallback = if down { hid_pressed } else { self.owned.contains(&b) };
        let (ours, how) = self.decide(class, sender_match, fallback);
        if ours && down {
            self.owned.insert(b);
        } else if !down {
            self.owned.remove(&b);
        }
        match self.mode {
            Mode::Events { suppress, .. } => {
                let app = if down && !repeat { format!("  app={}", objc::frontmost_app()) } else { String::new() };
                println!(
                    "{}  {:<16} {:<8} {}{}  sender={sender:#x} sender-match={} hid={}  => {}{app}",
                    log::timestamp(),
                    kind,
                    b.name(),
                    if down { "down" } else { "up  " },
                    if repeat { " (repeat)" } else { "" },
                    yn(sender_match),
                    if hid_pressed { "pressed " } else { "released" },
                    if ours { format!("RELACON via {how}") } else { "not relacon".into() }
                );
                suppress && ours
            }
            Mode::Run => {
                if !ours {
                    return false;
                }
                let swallow = self.engine.on_button(b, down, Instant::now());
                self.reschedule();
                swallow
            }
        }
    }

    fn print_motion_stats(&mut self) {
        if !matches!(self.mode, Mode::Events { motion: false, .. }) || self.motion.n == 0 {
            return;
        }
        let s = std::mem::take(&mut self.motion);
        let mut senders: Vec<_> = s.senders.iter().map(|(k, v)| format!("{k:#x}x{v}")).collect();
        senders.sort();
        println!(
            "{}  motion: {} events (sender-match {}, hid-only {}, neither {}) senders: {}",
            log::timestamp(),
            s.n,
            s.sender,
            s.hid,
            s.neither,
            senders.join(" ")
        );
    }

    fn reload(&mut self) {
        let path = self.config_path.clone();
        if !path.exists() {
            log!("config {} is gone; keeping the current one", path.display());
            return;
        }
        match config::load(&path) {
            Ok(cfg) => {
                self.engine.release_all(true);
                self.engine.cfg = cfg;
                log!("reloaded {}\n{}", path.display(), self.engine.cfg.summary().trim_end());
                self.reschedule();
                self.watch();
            }
            Err(e) => {
                log!("config error (keeping previous config): {e:#}");
                log::notify("relacon-d: config error", &format!("{e:#}"));
            }
        }
    }

    /// Watch the config's directory and, if it's a symlink, the target's directory.
    fn watch(&mut self) {
        let mut dirs = vec![];
        if let Some(d) = self.config_path.parent() {
            dirs.push(d.to_path_buf());
        }
        if let Ok(real) = std::fs::canonicalize(&self.config_path)
            && let Some(d) = real.parent()
        {
            dirs.push(d.to_path_buf());
        }
        let local = self.config_path.with_file_name("local.ts");
        if let Ok(real) = std::fs::canonicalize(local)
            && let Some(d) = real.parent()
        {
            dirs.push(d.to_path_buf());
        }
        dirs.sort();
        dirs.dedup();
        if dirs == self.watched && !self.stream.is_null() {
            return;
        }
        unsafe {
            if !self.stream.is_null() {
                FSEventStreamStop(self.stream);
                FSEventStreamInvalidate(self.stream);
                FSEventStreamRelease(self.stream);
                self.stream = std::ptr::null_mut();
            }
            let paths: Vec<CFString> = dirs.iter().map(|d| CFString::new(&d.to_string_lossy())).collect();
            let arr = CFArray::from_CFTypes(&paths);
            let ctx = FSEventStreamContext {
                version: 0,
                info: std::ptr::null_mut(),
                retain: std::ptr::null(),
                release: std::ptr::null(),
                copy_description: std::ptr::null(),
            };
            let stream = FSEventStreamCreate(
                std::ptr::null(),
                fsevents_cb,
                &ctx,
                arr.as_concrete_TypeRef(),
                kFSEventStreamEventIdSinceNow,
                0.05,
                kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer,
            );
            if stream.is_null() {
                log!("could not watch {dirs:?}");
                return;
            }
            FSEventStreamScheduleWithRunLoop(stream, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
            FSEventStreamStart(stream);
            self.stream = stream;
        }
        log!("watching {}", dirs.iter().map(|d| d.display().to_string()).collect::<Vec<_>>().join(", "));
        self.watched = dirs;
    }
}

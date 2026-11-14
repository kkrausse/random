mod apps;
mod chord;
mod config;
mod icons;
mod rank;
mod server;
mod ui;

use futures::StreamExt;
use futures::channel::mpsc::{UnboundedSender, unbounded};
use global_hotkey::hotkey::HotKey;
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};
use gpui::Application;
use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
use objc2_foundation::MainThreadMarker;
use std::io::Read;
use std::os::fd::FromRawFd;
use std::sync::atomic::{AtomicI32, Ordering};

enum Event {
    Hotkey,
    /// Open, never close: SIGUSR1, or Cmd tap then right Option (`chord`).
    Show,
    TabsChanged,
}

fn fail(message: String) -> ! {
    eprintln!("switcher: {message}");
    std::process::exit(1);
}

/// Write end of the pipe the SIGUSR1 handler pokes.
static SHOW_PIPE: AtomicI32 = AtomicI32::new(-1);

extern "C" fn on_show_signal(_: libc::c_int) {
    // Only async-signal-safe calls here: one write to a pipe.
    let fd = SHOW_PIPE.load(Ordering::Relaxed);
    unsafe { libc::write(fd, [1u8].as_ptr().cast(), 1) };
}

/// `pkill -USR1 -x switcher` opens the popover. A key remapper can run that
/// where a hotkey won't do, e.g. on a chord of bare modifiers, which also
/// have to stay held for something else (push-to-talk dictation).
fn open_on_signal(events: UnboundedSender<Event>) {
    let mut fds = [0; 2];
    // SAFETY: plain libc calls with valid arguments; the handler is installed
    // only after the pipe it writes to exists.
    let read_end = unsafe {
        if libc::pipe(fds.as_mut_ptr()) != 0 {
            return eprintln!("switcher: no pipe for SIGUSR1; it will be ignored");
        }
        SHOW_PIPE.store(fds[1], Ordering::Relaxed);
        libc::signal(
            libc::SIGUSR1,
            on_show_signal as extern "C" fn(libc::c_int) as libc::sighandler_t,
        );
        std::fs::File::from_raw_fd(fds[0])
    };
    std::thread::spawn(move || {
        let mut read_end = read_end;
        let mut byte = [0u8; 1];
        while read_end.read_exact(&mut byte).is_ok() {
            events.unbounded_send(Event::Show).ok();
        }
    });
}

fn main() {
    let config = config::load();
    let hotkeys: Vec<(String, HotKey)> = config
        .hotkeys
        .iter()
        .map(|text| match text.parse() {
            Ok(hotkey) => (text.clone(), hotkey),
            Err(error) => fail(format!("bad hotkey {text:?}: {error}")),
        })
        .collect();

    let (events, mut incoming) = unbounded();
    open_on_signal(events.clone());
    let connections = server::Connections::default();
    let tab_events = events.clone();
    server::serve(config.port, connections.clone(), move || {
        tab_events.unbounded_send(Event::TabsChanged).ok();
    })
    .unwrap_or_else(|error| {
        fail(format!(
            "cannot listen on 127.0.0.1:{}: {error}",
            config.port
        ))
    });

    Application::new().run(move |cx| {
        // GPUI launches as a regular app; drop the Dock icon and menu bar.
        let marker = MainThreadMarker::new().expect("GPUI runs on the main thread");
        NSApplication::sharedApplication(marker)
            .setActivationPolicy(NSApplicationActivationPolicy::Accessory);
        apps::track_activations();
        let chord_events = events.clone();
        chord::watch(move || {
            chord_events.unbounded_send(Event::Show).ok();
        });

        // Carbon hotkeys: no Accessibility permission needed.
        let manager = GlobalHotKeyManager::new()
            .unwrap_or_else(|error| fail(format!("hotkey manager: {error}")));
        // A hotkey another app holds is skipped, not fatal, as long as one
        // of them works.
        let registered: Vec<&str> = hotkeys
            .iter()
            .filter(|(text, hotkey)| match manager.register(*hotkey) {
                Ok(()) => true,
                Err(error) => {
                    eprintln!("switcher: cannot register hotkey {text:?}: {error}");
                    false
                }
            })
            .map(|(text, _)| text.as_str())
            .collect();
        if registered.is_empty() {
            fail("no hotkey could be registered".into());
        }
        std::mem::forget(manager); // registered for the life of the process
        GlobalHotKeyEvent::set_event_handler(Some(move |event: GlobalHotKeyEvent| {
            if event.state == HotKeyState::Pressed {
                events.unbounded_send(Event::Hotkey).ok();
            }
        }));

        eprintln!(
            "switcher: hotkeys {}, extension socket ws://127.0.0.1:{}",
            registered.join(", "),
            config.port
        );
        let window = ui::open(config, connections, cx)
            .unwrap_or_else(|error| fail(format!("cannot create the popover: {error}")));

        let peek = std::env::var_os("SWITCHER_PEEK").is_some();
        cx.spawn(async move |cx| {
            while let Some(event) = incoming.next().await {
                window
                    .update(cx, |switcher, window, cx| match event {
                        Event::Hotkey => switcher.toggle(window, cx),
                        Event::Show => switcher.open(window, cx),
                        Event::TabsChanged if peek => switcher.peek(window, cx),
                        Event::TabsChanged => switcher.tabs_changed(window, cx),
                    })
                    .ok();
            }
        })
        .detach();
    });
}

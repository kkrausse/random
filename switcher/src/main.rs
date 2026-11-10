mod apps;
mod config;
mod icons;
mod rank;
mod server;
mod ui;

use futures::StreamExt;
use futures::channel::mpsc::unbounded;
use global_hotkey::hotkey::HotKey;
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};
use gpui::Application;
use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
use objc2_foundation::MainThreadMarker;

enum Event {
    Hotkey,
    TabsChanged,
}

fn fail(message: String) -> ! {
    eprintln!("switcher: {message}");
    std::process::exit(1);
}

fn main() {
    let config = config::load();
    let hotkey: HotKey = config
        .hotkey
        .parse()
        .unwrap_or_else(|error| fail(format!("bad hotkey {:?}: {error}", config.hotkey)));

    let (events, mut incoming) = unbounded();
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

        // Carbon hotkeys: no Accessibility permission needed.
        let manager = GlobalHotKeyManager::new()
            .unwrap_or_else(|error| fail(format!("hotkey manager: {error}")));
        manager.register(hotkey).unwrap_or_else(|error| {
            fail(format!(
                "cannot register hotkey {:?}: {error}",
                config.hotkey
            ))
        });
        std::mem::forget(manager); // registered for the life of the process
        GlobalHotKeyEvent::set_event_handler(Some(move |event: GlobalHotKeyEvent| {
            if event.state == HotKeyState::Pressed {
                events.unbounded_send(Event::Hotkey).ok();
            }
        }));

        eprintln!(
            "switcher: hotkey {}, extension socket ws://127.0.0.1:{}",
            config.hotkey, config.port
        );
        let window = ui::open(config, connections, cx)
            .unwrap_or_else(|error| fail(format!("cannot create the popover: {error}")));

        let peek = std::env::var_os("SWITCHER_PEEK").is_some();
        cx.spawn(async move |cx| {
            while let Some(event) = incoming.next().await {
                window
                    .update(cx, |switcher, window, cx| match event {
                        Event::Hotkey => switcher.toggle(window, cx),
                        Event::TabsChanged if peek => switcher.peek(window, cx),
                        Event::TabsChanged => switcher.tabs_changed(window, cx),
                    })
                    .ok();
            }
        })
        .detach();
    });
}

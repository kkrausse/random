//! The popover: a borderless, non-activating panel with a query line and results.

use gpui::{
    App, Bounds, Context, FocusHandle, KeyDownEvent, ScrollDelta, ScrollWheelEvent, Window,
    WindowBackgroundAppearance, WindowBounds, WindowHandle, WindowKind, WindowOptions, div, img, prelude::*, px, rgb, rgba, size,
};
use objc2::rc::Retained;
use objc2_app_kit::{NSScreen, NSView, NSWindow};
use objc2_foundation::MainThreadMarker;
use std::time::{Duration, Instant};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

use crate::apps;
use crate::config::Config;
use crate::rank::{self, Item, Target};
use crate::server::{self, Connections};

const WIDTH: f32 = 680.0;
const INPUT_HEIGHT: f32 = 54.0;
const ROW_HEIGHT: f32 = 46.0;
const VISIBLE_ROWS: usize = 9;
/// Trackpad travel, in points, that moves the selection one row.
const WHEEL_STEP: f32 = 110.0;
/// Shortest gap between two rows moved by a mouse wheel. Some wheels send
/// several events per detent; this folds them into one step.
const WHEEL_GAP: Duration = Duration::from_millis(90);
/// Dims the screen behind the card. Also what makes the whole screen take the
/// wheel and outside clicks.
const SCRIM: u32 = 0x00000030;
const HEIGHT: f32 = INPUT_HEIGHT + ROW_HEIGHT * VISIBLE_ROWS as f32 + 14.0;

const BACKGROUND: u32 = 0x1b1b1d;
const BORDER: u32 = 0x38383c;
const SELECTED: u32 = 0x2f3b55;
const TEXT: u32 = 0xe8e8ea;
const DIM: u32 = 0x8a8a90;
const ACCENT: u32 = 0x6ea8fe;
const ICON_SIZE: f32 = 20.0;

pub struct Switcher {
    config: Config,
    connections: Connections,
    focus: FocusHandle,
    query: String,
    items: Vec<Item>,
    /// Indices into `items`, best first.
    results: Vec<usize>,
    selected: usize,
    /// Index of the first rendered result.
    scroll: usize,
    /// Trackpad scroll not yet turned into a selection move.
    wheel: f32,
    /// When a mouse wheel last moved the selection.
    wheel_moved: Option<Instant>,
    log_scroll: bool,
}

/// Creates the popover hidden, so the hotkey only has to order it front.
pub fn open(
    config: Config,
    connections: Connections,
    cx: &mut App,
) -> gpui::Result<WindowHandle<Switcher>> {
    let options = WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
            None,
            size(px(WIDTH), px(HEIGHT)),
            cx,
        ))),
        titlebar: None,
        window_background: WindowBackgroundAppearance::Transparent,
        focus: false,
        show: false,
        // An NSPanel that takes key input without activating this app, at
        // pop-up level, on every space including fullscreen ones.
        kind: WindowKind::PopUp,
        is_movable: false,
        is_resizable: false,
        is_minimizable: false,
        ..Default::default()
    };
    cx.open_window(options, |window, cx| {
        cx.new(|cx| {
            cx.observe_window_activation(window, |this: &mut Switcher, window, cx| {
                if !window.is_window_active() {
                    this.hide(window, cx);
                }
            })
            .detach();
            Switcher {
                config,
                connections,
                focus: cx.focus_handle(),
                query: String::new(),
                items: Vec::new(),
                results: Vec::new(),
                selected: 0,
                scroll: 0,
                wheel: 0.0,
                wheel_moved: None,
                log_scroll: std::env::var_os("SWITCHER_LOG_SCROLL").is_some(),
            }
        })
    })
}

fn native_window(window: &Window) -> Option<Retained<NSWindow>> {
    let handle = HasWindowHandle::window_handle(window).ok()?;
    let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
        return None;
    };
    // SAFETY: GPUI hands out its live NSView, and we are on the main thread.
    let view = unsafe { handle.ns_view.cast::<NSView>().as_ref() };
    view.window()
}

/// Stretches the (transparent) panel over the screen holding the focused
/// window. The card is drawn in the middle of it; covering the screen means
/// the wheel reaches the switcher wherever the pointer is, and a click
/// anywhere outside the card lands on us and dismisses it.
fn cover_screen(native: &NSWindow, takes_mouse: bool) {
    if let Some(screen) = MainThreadMarker::new().and_then(NSScreen::mainScreen) {
        native.setFrame_display(screen.frame(), true);
    }
    native.setHasShadow(false);
    native.setIgnoresMouseEvents(!takes_mouse);
}

impl Switcher {
    pub fn toggle(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if native_window(window).is_some_and(|native| native.isVisible()) {
            self.hide(window, cx);
        } else {
            self.show(window, cx);
        }
    }

    fn show(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(native) = native_window(window) else {
            return;
        };
        // Snapshot before we take key focus, while "frontmost" is still the
        // app the user came from.
        self.query.clear();
        self.reload(cx);

        window.focus(&self.focus);
        // Resizing makes AppKit call back into GPUI, which drops the callback
        // (and keeps the old layout) while the app is borrowed, as it is
        // here. So touch the native window from a task, outside any update.
        cx.spawn(async move |_, _| {
            cover_screen(&native, true);
            native.makeKeyAndOrderFront(None);
        })
        .detach();
    }

    /// Debugging aid (`SWITCHER_PEEK`): puts the list on screen without taking
    /// keyboard focus, so it can be screenshotted without a hotkey press and
    /// without disturbing whatever is being typed into.
    pub fn peek(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(native) = native_window(window) {
            self.reload(cx);
            cx.spawn(async move |_, _| {
                // Mouse-transparent: a peek must not swallow clicks.
                cover_screen(&native, false);
                native.orderFrontRegardless();
            })
            .detach();
        }
    }

    fn hide(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(native) = native_window(window) {
            native.orderOut(None);
        }
        // Leave nothing stale to flash on the next show.
        self.query.clear();
        self.items.clear();
        self.results.clear();
        cx.notify();
    }

    /// Re-reads tabs and apps. Called on show and when tabs change while visible.
    pub fn reload(&mut self, cx: &mut Context<Self>) {
        self.items = rank::collect(&self.connections, self.config.browser_bundle_id.as_deref());
        self.rerank(cx);
    }

    pub fn tabs_changed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if native_window(window).is_some_and(|native| native.isVisible()) {
            let selected = self
                .results
                .get(self.selected)
                .map(|&index| self.items[index].target);
            self.reload(cx);
            // Keep the cursor on the same thing if it survived the update.
            if let Some(position) = selected.and_then(|target| {
                self.results
                    .iter()
                    .position(|&index| same_target(self.items[index].target, target))
            }) {
                self.select(position);
            }
        }
    }

    fn rerank(&mut self, cx: &mut Context<Self>) {
        self.results = rank::rank(&self.items, &self.query);
        self.selected = 0;
        self.scroll = 0;
        self.wheel = 0.0;
        cx.notify();
    }

    fn select(&mut self, position: usize) {
        self.selected = position;
        if self.selected < self.scroll {
            self.scroll = self.selected;
        } else if self.selected >= self.scroll + VISIBLE_ROWS {
            self.scroll = self.selected + 1 - VISIBLE_ROWS;
        }
    }

    fn move_selection(&mut self, delta: isize, cx: &mut Context<Self>) {
        let count = self.results.len() as isize;
        if count > 0 {
            self.select((self.selected as isize + delta).rem_euclid(count) as usize);
            cx.notify();
        }
    }

    /// The wheel moves the selection rather than scrolling the list. It stops
    /// at the ends: wrapping mid-spin is disorienting.
    fn scroll_wheel(&mut self, event: &ScrollWheelEvent, _: &mut Window, cx: &mut Context<Self>) {
        if self.log_scroll {
            eprintln!("switcher: scroll {:?} {:?}", event.delta, event.touch_phase);
        }
        let rows = match event.delta {
            // A mouse wheel: one row per detent, whatever the delta (macOS
            // acceleration makes it anything from a fraction of a line to
            // many) and however many events the detent is split into.
            ScrollDelta::Lines(lines) if lines.y != 0.0 => {
                let now = Instant::now();
                if self
                    .wheel_moved
                    .is_some_and(|moved| now.duration_since(moved) < WHEEL_GAP)
                {
                    return;
                }
                self.wheel_moved = Some(now);
                -lines.y.signum() as isize
            }
            ScrollDelta::Lines(_) => 0,
            ScrollDelta::Pixels(pixels) => {
                self.wheel -= f32::from(pixels.y);
                let rows = (self.wheel / WHEEL_STEP).trunc();
                self.wheel -= rows * WHEEL_STEP;
                rows as isize
            }
        };
        let Some(last) = self.results.len().checked_sub(1) else {
            return;
        };
        let target = (self.selected as isize + rows).clamp(0, last as isize) as usize;
        if target != self.selected {
            self.select(target);
            cx.notify();
        }
    }

    fn activate(&mut self, position: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(target) = self
            .results
            .get(position)
            .map(|&index| self.items[index].target)
        else {
            return;
        };
        self.hide(window, cx);
        match target {
            Target::App { pid } => {
                if !apps::activate_pid(pid) {
                    eprintln!("switcher: could not activate pid {pid}");
                }
            }
            Target::Tab {
                connection,
                tab_id,
                window_id,
                browser,
            } => {
                if !server::activate_tab(&self.connections, connection, tab_id, window_id) {
                    eprintln!("switcher: the extension for tab {tab_id} is gone");
                }
                // The extension focuses the tab; raising the browser is on us.
                if !browser.is_some_and(apps::activate_pid) {
                    eprintln!(
                        "switcher: could not bring the browser to the front; \
                         set browser_bundle_id in config.toml"
                    );
                }
            }
        }
    }

    fn delete_word(&mut self) {
        let trimmed = self.query.trim_end();
        let cut = trimmed
            .rfind(char::is_whitespace)
            .map_or(0, |index| index + 1);
        self.query.truncate(cut);
    }

    fn key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let keystroke = &event.keystroke;
        let modifiers = keystroke.modifiers;
        let control = modifiers.control && !modifiers.platform && !modifiers.alt;
        cx.stop_propagation();
        match keystroke.key.as_str() {
            "escape" => return self.hide(window, cx),
            "enter" => return self.activate(self.selected, window, cx),
            "up" => return self.move_selection(-1, cx),
            "down" => return self.move_selection(1, cx),
            "p" if control => return self.move_selection(-1, cx),
            "n" if control => return self.move_selection(1, cx),
            "tab" => return self.move_selection(if modifiers.shift { -1 } else { 1 }, cx),
            "backspace" if modifiers.platform => self.query.clear(),
            "backspace" if modifiers.alt => self.delete_word(),
            "backspace" => drop(self.query.pop()),
            "u" if control => self.query.clear(),
            "w" if control => self.delete_word(),
            "v" if modifiers.platform => {
                let pasted = cx.read_from_clipboard().and_then(|item| item.text());
                self.query.extend(
                    pasted
                        .iter()
                        .flat_map(|text| text.chars())
                        .filter(|c| !c.is_control()),
                );
            }
            _ if modifiers.control || modifiers.platform => return,
            _ => match &keystroke.key_char {
                Some(typed) if !typed.chars().any(char::is_control) => self.query.push_str(typed),
                _ => return,
            },
        }
        self.rerank(cx);
    }

    fn render_row(&self, position: usize, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let item = &self.items[self.results[position]];
        // The icon says what the row is. Rows without one (not sent yet, or
        // the page has no favicon) keep its box so titles stay aligned.
        let icon = div().size(px(ICON_SIZE)).flex_none();
        let icon = match &item.icon {
            Some(image) => icon.child(img(image.clone()).size_full()),
            None => icon.rounded(px(5.0)).bg(rgb(BORDER)),
        };
        div()
            .id(("row", position))
            .h(px(ROW_HEIGHT))
            .mx(px(6.0))
            .px(px(12.0))
            .rounded(px(7.0))
            .flex()
            .items_center()
            .gap(px(12.0))
            .when(position == self.selected, |row| row.bg(rgb(SELECTED)))
            .on_click(cx.listener(move |this, _, window, cx| this.activate(position, window, cx)))
            .child(icon)
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .truncate()
                            .text_size(px(14.0))
                            .child(item.title.clone()),
                    )
                    .child(
                        div()
                            .truncate()
                            .text_size(px(11.0))
                            .text_color(rgb(DIM))
                            .child(item.subtitle.clone()),
                    ),
            )
    }
}

fn same_target(a: Target, b: Target) -> bool {
    match (a, b) {
        (Target::App { pid: a }, Target::App { pid: b }) => a == b,
        (
            Target::Tab {
                connection: a,
                tab_id: a_tab,
                ..
            },
            Target::Tab {
                connection: b,
                tab_id: b_tab,
                ..
            },
        ) => a == b && a_tab == b_tab,
        _ => false,
    }
}

impl Render for Switcher {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // Slightly above center, like Spotlight.
        let top = ((f32::from(window.viewport_size().height) - HEIGHT) * 0.38).max(0.0);
        let end = (self.scroll + VISIBLE_ROWS).min(self.results.len());
        let rows: Vec<_> = (self.scroll..end)
            .map(|position| self.render_row(position, cx))
            .collect();
        let empty = self.results.is_empty();

        let input = div()
            .h(px(INPUT_HEIGHT))
            .px(px(18.0))
            .flex()
            .items_center()
            .text_size(px(18.0))
            .border_b_1()
            .border_color(rgb(BORDER))
            .child(self.query.clone())
            .child(div().w(px(1.5)).h(px(22.0)).bg(rgb(ACCENT)))
            .when(self.query.is_empty(), |input| {
                input.child(
                    div()
                        .ml(px(6.0))
                        .text_color(rgb(DIM))
                        .child("Search tabs and apps"),
                )
            })
            .child(div().flex_1())
            .child(
                div()
                    .text_size(px(11.0))
                    .text_color(rgb(DIM))
                    .child(format!("{}", self.results.len())),
            );

        div()
            .size_full()
            .track_focus(&self.focus)
            .on_key_down(cx.listener(Self::key_down))
            .on_scroll_wheel(cx.listener(Self::scroll_wheel))
            .on_any_mouse_down(cx.listener(|this, _, window, cx| this.hide(window, cx)))
            .bg(rgba(SCRIM))
            .flex()
            .flex_col()
            .items_center()
            .child(
                div()
                    .mt(px(top))
                    .w(px(WIDTH))
                    .on_any_mouse_down(|_, _, cx| cx.stop_propagation())
                    .bg(rgb(BACKGROUND))
                    .border_1()
                    .border_color(rgb(BORDER))
                    .rounded(px(12.0))
                    .overflow_hidden()
                    .flex()
                    .flex_col()
                    .text_color(rgb(TEXT))
                    .child(input)
                    .child(div().py(px(6.0)).flex().flex_col().children(rows).when(
                        empty,
                        |list| {
                            list.child(
                                div()
                                    .h(px(ROW_HEIGHT))
                                    .px(px(18.0))
                                    .flex()
                                    .items_center()
                                    .text_size(px(13.0))
                                    .text_color(rgb(DIM))
                                    .child("No matches"),
                            )
                        },
                    )),
            )
    }
}

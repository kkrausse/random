//! Running macOS apps: listing, activation, and most-recently-used tracking.

use std::collections::HashMap;
use std::ptr::NonNull;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use block2::RcBlock;
use objc2::AnyThread;
use objc2_app_kit::{
    NSApplicationActivationOptions, NSApplicationActivationPolicy, NSBitmapImageFileType,
    NSBitmapImageRep, NSDeviceRGBColorSpace, NSGraphicsContext, NSRunningApplication, NSWorkspace,
    NSWorkspaceDidActivateApplicationNotification,
};
use objc2_foundation::{NSDictionary, NSNotification, NSPoint, NSRect, NSSize, NSString};

use crate::icons::{self, Icon};

pub struct RunningApp {
    pub pid: i32,
    pub name: String,
    /// Milliseconds since the epoch of the last activation we saw, or 0.
    pub last_active: f64,
    pub icon: Option<Icon>,
}

/// Rendered pixel size of app icons: the row shows them at 20pt, so 2x and a bit.
const ICON_PIXELS: isize = 64;

/// pid -> its icon (None if it has none), rendered the first time the app is listed.
static ICONS: Mutex<Option<HashMap<i32, Option<Icon>>>> = Mutex::new(None);

/// Draws the app's icon into a small bitmap and hands it over as PNG bytes.
fn render_icon(app: &NSRunningApplication) -> Option<Icon> {
    let icon = app.icon()?;
    // SAFETY: null planes ask AppKit to allocate the pixel buffer itself.
    let bitmap = unsafe {
        NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
            NSBitmapImageRep::alloc(),
            std::ptr::null_mut(),
            ICON_PIXELS,
            ICON_PIXELS,
            8,
            4,
            true,
            false,
            NSDeviceRGBColorSpace,
            0,
            0,
        )
    }?;
    let context = NSGraphicsContext::graphicsContextWithBitmapImageRep(&bitmap)?;
    let previous = NSGraphicsContext::currentContext();
    NSGraphicsContext::setCurrentContext(Some(&context));
    let side = ICON_PIXELS as f64;
    icon.drawInRect(NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(side, side)));
    context.flushGraphics();
    NSGraphicsContext::setCurrentContext(previous.as_deref());
    // SAFETY: no properties, so nothing to get the type of wrong.
    let png = unsafe {
        bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }?;
    icons::decode(&png.to_vec())
}

/// pid -> last activation time (ms since epoch, to compare with tab `lastAccessed`).
static LAST_ACTIVE: Mutex<Option<HashMap<i32, f64>>> = Mutex::new(None);

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |elapsed| elapsed.as_secs_f64() * 1000.0)
}

fn mark_frontmost_active() {
    if let Some(app) = NSWorkspace::sharedWorkspace().frontmostApplication() {
        LAST_ACTIVE
            .lock()
            .unwrap()
            .get_or_insert_default()
            .insert(app.processIdentifier(), now_ms());
    }
}

/// Starts recording app activations. Call once, on the main thread.
pub fn track_activations() {
    mark_frontmost_active();
    let block = RcBlock::new(|_: NonNull<NSNotification>| mark_frontmost_active());
    let center = NSWorkspace::sharedWorkspace().notificationCenter();
    let observer = unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(NSWorkspaceDidActivateApplicationNotification),
            None,
            None,
            &block,
        )
    };
    // Observe for the life of the process.
    std::mem::forget(observer);
}

/// Apps with a Dock presence (regular activation policy). Main thread only.
pub fn running() -> Vec<RunningApp> {
    let mut last_active = LAST_ACTIVE.lock().unwrap();
    let last_active = last_active.get_or_insert_default();
    let mut icons = ICONS.lock().unwrap();
    let icons = icons.get_or_insert_default();
    let apps: Vec<RunningApp> = NSWorkspace::sharedWorkspace()
        .runningApplications()
        .iter()
        .filter(|app| app.activationPolicy() == NSApplicationActivationPolicy::Regular)
        .map(|app| {
            let pid = app.processIdentifier();
            RunningApp {
                pid,
                name: app
                    .localizedName()
                    .map(|name| name.to_string())
                    .unwrap_or_default(),
                last_active: last_active.get(&pid).copied().unwrap_or(0.0),
                icon: icons
                    .entry(pid)
                    .or_insert_with(|| render_icon(&app))
                    .clone(),
            }
        })
        .collect();
    last_active.retain(|pid, _| apps.iter().any(|app| app.pid == *pid));
    icons.retain(|pid, _| apps.iter().any(|app| app.pid == *pid));
    apps
}

/// Pid of the app the user is currently in.
pub fn frontmost_pid() -> Option<i32> {
    let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
    Some(app.processIdentifier())
}

fn activate(app: &NSRunningApplication) -> bool {
    app.activateWithOptions(NSApplicationActivationOptions::ActivateAllWindows)
}

/// The regular app that `pid` is, or is a descendant of: (pid, name).
///
/// A browser's sockets belong to a helper process whose parent is the browser.
/// Safe off the main thread (NSRunningApplication is thread safe).
pub fn owning_app(mut pid: i32) -> Option<(i32, String)> {
    for _ in 0..8 {
        if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
            && app.activationPolicy() == NSApplicationActivationPolicy::Regular
        {
            let name = app.localizedName().map(|name| name.to_string());
            return Some((pid, name.unwrap_or_default()));
        }
        let output = std::process::Command::new("/bin/ps")
            .args(["-o", "ppid=", "-p", &pid.to_string()])
            .output()
            .ok()?;
        pid = String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse()
            .ok()?;
        if pid <= 1 {
            break;
        }
    }
    None
}

pub fn activate_pid(pid: i32) -> bool {
    NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
        .is_some_and(|app| activate(&app))
}

/// Pid of a running app with this bundle id.
pub fn pid_for_bundle(bundle_id: &str) -> Option<i32> {
    NSRunningApplication::runningApplicationsWithBundleIdentifier(&NSString::from_str(bundle_id))
        .iter()
        .next()
        .map(|app| app.processIdentifier())
}

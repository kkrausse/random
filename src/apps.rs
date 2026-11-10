//! Running macOS apps: listing, activation, and most-recently-used tracking.

use std::collections::HashMap;
use std::ptr::NonNull;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use block2::RcBlock;
use objc2_app_kit::{
    NSApplicationActivationOptions, NSApplicationActivationPolicy, NSRunningApplication,
    NSWorkspace, NSWorkspaceDidActivateApplicationNotification,
};
use objc2_foundation::{NSNotification, NSString};

pub struct RunningApp {
    pub pid: i32,
    pub name: String,
    /// Milliseconds since the epoch of the last activation we saw, or 0.
    pub last_active: f64,
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

fn bundle_id(app: &NSRunningApplication) -> Option<String> {
    app.bundleIdentifier().map(|id| id.to_string())
}

/// Apps with a Dock presence (regular activation policy).
pub fn running() -> Vec<RunningApp> {
    let mut last_active = LAST_ACTIVE.lock().unwrap();
    let last_active = last_active.get_or_insert_default();
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
            }
        })
        .collect();
    last_active.retain(|pid, _| apps.iter().any(|app| app.pid == *pid));
    apps
}

/// (pid, bundle id) of the app the user is currently in.
pub fn frontmost() -> Option<(i32, Option<String>)> {
    let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
    Some((app.processIdentifier(), bundle_id(&app)))
}

fn activate(app: &NSRunningApplication) -> bool {
    app.activateWithOptions(NSApplicationActivationOptions::ActivateAllWindows)
}

pub fn activate_pid(pid: i32) -> bool {
    NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
        .is_some_and(|app| activate(&app))
}

/// Activates the running app with this bundle id. False if it is not running
/// or refused activation.
pub fn activate_bundle(bundle_id: &str) -> bool {
    NSRunningApplication::runningApplicationsWithBundleIdentifier(&NSString::from_str(bundle_id))
        .iter()
        .next()
        .is_some_and(|app| activate(&app))
}

//! Hand-written FFI for the bits of CoreGraphics, IOKit, CoreServices and
//! ApplicationServices that the crates don't cover (or cover awkwardly).
#![allow(non_upper_case_globals, non_snake_case, non_camel_case_types, dead_code, deprecated)]

use core_foundation_sys::array::CFArrayRef;
use core_foundation_sys::base::{CFAllocatorRef, CFTypeRef};
use core_foundation_sys::dictionary::CFDictionaryRef;
use core_foundation_sys::mach_port::CFMachPortRef;
use core_foundation_sys::runloop::CFRunLoopRef;
use core_foundation_sys::string::CFStringRef;
use std::ffi::{c_char, c_void};

// ---------------------------------------------------------------- CoreGraphics

pub type CGEventRef = *mut c_void;
pub type CGEventSourceRef = *mut c_void;
pub type CGEventTapProxy = *mut c_void;
pub type CGEventTapCallBack =
    extern "C" fn(proxy: CGEventTapProxy, ty: u32, event: CGEventRef, refcon: *mut c_void) -> CGEventRef;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct CGPoint {
    pub x: f64,
    pub y: f64,
}

// Event types
pub const kCGEventNull: u32 = 0;
pub const kCGEventLeftMouseDown: u32 = 1;
pub const kCGEventLeftMouseUp: u32 = 2;
pub const kCGEventRightMouseDown: u32 = 3;
pub const kCGEventRightMouseUp: u32 = 4;
pub const kCGEventMouseMoved: u32 = 5;
pub const kCGEventLeftMouseDragged: u32 = 6;
pub const kCGEventRightMouseDragged: u32 = 7;
pub const kCGEventKeyDown: u32 = 10;
pub const kCGEventKeyUp: u32 = 11;
pub const kCGEventFlagsChanged: u32 = 12;
pub const NX_SYSDEFINED: u32 = 14;
pub const kCGEventScrollWheel: u32 = 22;
pub const kCGEventOtherMouseDown: u32 = 25;
pub const kCGEventOtherMouseUp: u32 = 26;
pub const kCGEventOtherMouseDragged: u32 = 27;
pub const kCGEventTapDisabledByTimeout: u32 = 0xFFFF_FFFE;
pub const kCGEventTapDisabledByUserInput: u32 = 0xFFFF_FFFF;

// Event fields
pub const kCGMouseEventClickState: u32 = 1;
pub const kCGMouseEventButtonNumber: u32 = 3;
pub const kCGMouseEventDeltaX: u32 = 4;
pub const kCGMouseEventDeltaY: u32 = 5;
pub const kCGScrollWheelEventDeltaAxis1: u32 = 11;
pub const kCGScrollWheelEventDeltaAxis2: u32 = 12;
pub const kCGEventSourceUserData: u32 = 42;
pub const kCGScrollWheelEventIsContinuous: u32 = 88;
/// Undocumented `kCGEventSenderID`: registry entry ID of the IOHIDService that produced the event.
pub const kCGEventSenderID: u32 = 87;

// Flags
pub const kCGEventFlagMaskAlphaShift: u64 = 0x0001_0000;
pub const kCGEventFlagMaskShift: u64 = 0x0002_0000;
pub const kCGEventFlagMaskControl: u64 = 0x0004_0000;
pub const kCGEventFlagMaskAlternate: u64 = 0x0008_0000;
pub const kCGEventFlagMaskCommand: u64 = 0x0010_0000;
pub const kCGEventFlagMaskSecondaryFn: u64 = 0x0080_0000;
pub const kCGEventFlagMaskNumericPad: u64 = 0x0020_0000;
pub const kCGEventFlagMaskNonCoalesced: u64 = 0x0000_0100;

// Tap placement
pub const kCGHIDEventTap: u32 = 0;
pub const kCGSessionEventTap: u32 = 1;
pub const kCGHeadInsertEventTap: u32 = 0;
pub const kCGEventTapOptionDefault: u32 = 0;
pub const kCGEventTapOptionListenOnly: u32 = 1;

pub const kCGEventSourceStatePrivate: i32 = -1;
pub const kCGEventSourceStateHIDSystemState: i32 = 1;
pub const kCGScrollEventUnitLine: u32 = 1;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    pub fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: CGEventTapCallBack,
        refcon: *mut c_void,
    ) -> CFMachPortRef;
    pub fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
    pub fn CGEventGetType(event: CGEventRef) -> u32;
    pub fn CGEventSetType(event: CGEventRef, ty: u32);
    pub fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
    pub fn CGEventSetIntegerValueField(event: CGEventRef, field: u32, value: i64);
    pub fn CGEventGetFlags(event: CGEventRef) -> u64;
    pub fn CGEventSetFlags(event: CGEventRef, flags: u64);
    pub fn CGEventGetLocation(event: CGEventRef) -> CGPoint;
    pub fn CGEventCreate(source: CGEventSourceRef) -> CGEventRef;
    pub fn CGEventCreateKeyboardEvent(source: CGEventSourceRef, keycode: u16, down: bool) -> CGEventRef;
    pub fn CGEventCreateMouseEvent(
        source: CGEventSourceRef,
        ty: u32,
        location: CGPoint,
        button: u32,
    ) -> CGEventRef;
    pub fn CGEventCreateScrollWheelEvent2(
        source: CGEventSourceRef,
        units: u32,
        wheel_count: u32,
        wheel1: i32,
        wheel2: i32,
        wheel3: i32,
    ) -> CGEventRef;
    pub fn CGEventPost(tap: u32, event: CGEventRef);
    pub fn CGEventSourceCreate(state: i32) -> CGEventSourceRef;
}

// ---------------------------------------------------------------- IOKit / IOHID

pub type IOHIDManagerRef = *mut c_void;
pub type IOHIDDeviceRef = *mut c_void;
pub type IOHIDValueRef = *mut c_void;
pub type IOHIDElementRef = *mut c_void;
pub type IOReturn = i32;
pub type io_object_t = u32;

pub const kIOReturnSuccess: IOReturn = 0;
pub const kIOHIDOptionsTypeNone: u32 = 0;
pub const kIORegistryIterateRecursively: u32 = 1;
pub const kIOHIDRequestTypeListenEvent: u32 = 1;
pub const kIOHIDAccessTypeGranted: u32 = 0;
pub const kIOHIDAccessTypeDenied: u32 = 1;
pub const kIOHIDAccessTypeUnknown: u32 = 2;

pub type IOHIDDeviceCallback =
    extern "C" fn(context: *mut c_void, result: IOReturn, sender: *mut c_void, device: IOHIDDeviceRef);
pub type IOHIDValueCallback =
    extern "C" fn(context: *mut c_void, result: IOReturn, sender: *mut c_void, value: IOHIDValueRef);

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    pub fn IOHIDManagerCreate(allocator: CFAllocatorRef, options: u32) -> IOHIDManagerRef;
    pub fn IOHIDManagerSetDeviceMatching(manager: IOHIDManagerRef, matching: CFDictionaryRef);
    pub fn IOHIDManagerRegisterDeviceMatchingCallback(
        manager: IOHIDManagerRef,
        callback: IOHIDDeviceCallback,
        context: *mut c_void,
    );
    pub fn IOHIDManagerRegisterDeviceRemovalCallback(
        manager: IOHIDManagerRef,
        callback: IOHIDDeviceCallback,
        context: *mut c_void,
    );
    pub fn IOHIDManagerRegisterInputValueCallback(
        manager: IOHIDManagerRef,
        callback: IOHIDValueCallback,
        context: *mut c_void,
    );
    pub fn IOHIDManagerScheduleWithRunLoop(manager: IOHIDManagerRef, run_loop: CFRunLoopRef, mode: CFStringRef);
    pub fn IOHIDManagerOpen(manager: IOHIDManagerRef, options: u32) -> IOReturn;
    pub fn IOHIDManagerClose(manager: IOHIDManagerRef, options: u32) -> IOReturn;

    pub fn IOHIDDeviceGetService(device: IOHIDDeviceRef) -> io_object_t;
    pub fn IOHIDDeviceGetProperty(device: IOHIDDeviceRef, key: CFStringRef) -> CFTypeRef;
    pub fn IOHIDDeviceCopyMatchingElements(
        device: IOHIDDeviceRef,
        matching: CFDictionaryRef,
        options: u32,
    ) -> CFArrayRef;
    pub fn IOHIDDeviceGetValue(device: IOHIDDeviceRef, element: IOHIDElementRef, value: *mut IOHIDValueRef) -> IOReturn;

    pub fn IOHIDValueGetElement(value: IOHIDValueRef) -> IOHIDElementRef;
    pub fn IOHIDValueGetIntegerValue(value: IOHIDValueRef) -> isize;
    pub fn IOHIDValueGetTimeStamp(value: IOHIDValueRef) -> u64;
    pub fn IOHIDElementGetUsagePage(element: IOHIDElementRef) -> u32;
    pub fn IOHIDElementGetUsage(element: IOHIDElementRef) -> u32;
    pub fn IOHIDElementGetDevice(element: IOHIDElementRef) -> IOHIDDeviceRef;

    pub fn IORegistryEntryGetRegistryEntryID(entry: io_object_t, id: *mut u64) -> IOReturn;
    pub fn IORegistryEntryCreateIterator(
        entry: io_object_t,
        plane: *const c_char,
        options: u32,
        iterator: *mut io_object_t,
    ) -> IOReturn;
    pub fn IORegistryEntryGetName(entry: io_object_t, name: *mut c_char) -> IOReturn;
    pub fn IOObjectGetClass(object: io_object_t, name: *mut c_char) -> IOReturn;
    pub fn IOIteratorNext(iterator: io_object_t) -> io_object_t;
    pub fn IOObjectRelease(object: io_object_t) -> IOReturn;

    pub fn IOHIDCheckAccess(request: u32) -> u32;
    pub fn IOHIDRequestAccess(request: u32) -> bool;
}

// ---------------------------------------------------------------- ApplicationServices

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    pub static kAXTrustedCheckOptionPrompt: CFStringRef;
    pub fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
}

// ---------------------------------------------------------------- CoreServices / FSEvents

pub type FSEventStreamRef = *mut c_void;
pub type FSEventStreamCallback = extern "C" fn(
    stream: FSEventStreamRef,
    info: *mut c_void,
    num_events: usize,
    event_paths: *mut c_void,
    event_flags: *const u32,
    event_ids: *const u64,
);

#[repr(C)]
pub struct FSEventStreamContext {
    pub version: isize,
    pub info: *mut c_void,
    pub retain: *const c_void,
    pub release: *const c_void,
    pub copy_description: *const c_void,
}

pub const kFSEventStreamEventIdSinceNow: u64 = u64::MAX;
pub const kFSEventStreamCreateFlagNoDefer: u32 = 0x02;
pub const kFSEventStreamCreateFlagFileEvents: u32 = 0x10;

#[link(name = "CoreServices", kind = "framework")]
unsafe extern "C" {
    pub fn FSEventStreamCreate(
        allocator: CFAllocatorRef,
        callback: FSEventStreamCallback,
        context: *const FSEventStreamContext,
        paths: CFArrayRef,
        since_when: u64,
        latency: f64,
        flags: u32,
    ) -> FSEventStreamRef;
    pub fn FSEventStreamScheduleWithRunLoop(stream: FSEventStreamRef, run_loop: CFRunLoopRef, mode: CFStringRef);
    pub fn FSEventStreamStart(stream: FSEventStreamRef) -> bool;
    pub fn FSEventStreamStop(stream: FSEventStreamRef);
    pub fn FSEventStreamInvalidate(stream: FSEventStreamRef);
    pub fn FSEventStreamRelease(stream: FSEventStreamRef);
}

// AppKit is needed for NSEvent (media keys) and NSWorkspace (frontmost app).
#[link(name = "AppKit", kind = "framework")]
unsafe extern "C" {}

unsafe extern "C" {
    pub fn mach_absolute_time() -> u64;
}

/// Mach absolute time units to nanoseconds.
pub fn mach_to_ns(t: u64) -> u64 {
    use std::sync::OnceLock;
    static TB: OnceLock<(u32, u32)> = OnceLock::new();
    let (numer, denom) = *TB.get_or_init(|| {
        let mut info = libc::mach_timebase_info { numer: 0, denom: 0 };
        unsafe { libc::mach_timebase_info(&mut info) };
        (info.numer, info.denom)
    });
    ((t as u128 * numer as u128) / denom.max(1) as u128) as u64
}

pub fn now_ns() -> u64 {
    mach_to_ns(unsafe { mach_absolute_time() })
}

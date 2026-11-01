//! The three AppKit calls we need: decode/encode NX_SYSDEFINED media key events
//! (NSEvent), and the frontmost app's bundle id (NSWorkspace).

use crate::ffi::{CGEventRef, CGPoint};
use objc2::encode::{Encode, Encoding, RefEncode};
use objc2::rc::autoreleasepool;
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use std::ffi::{CStr, c_char};

#[repr(C)]
struct OpaqueCGEvent {
    _p: [u8; 0],
}
unsafe impl RefEncode for OpaqueCGEvent {
    const ENCODING_REF: Encoding = Encoding::Pointer(&Encoding::Struct("__CGEvent", &[]));
}

#[repr(C)]
#[derive(Clone, Copy)]
struct NSPoint(CGPoint);
unsafe impl Encode for NSPoint {
    const ENCODING: Encoding = Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
}

const NS_SYSTEM_DEFINED: usize = 14;
const MEDIA_SUBTYPE: i16 = 8;

/// Decoded NX_SYSDEFINED aux-control (media) key.
#[derive(Clone, Copy, Debug)]
pub struct MediaKey {
    pub code: u8,
    pub down: bool,
    pub repeat: bool,
}

/// Decode an NX_SYSDEFINED event. `None` if it's not a media key event (subtype 8).
pub fn parse_media(ev: CGEventRef) -> Option<MediaKey> {
    autoreleasepool(|_| unsafe {
        let ns: *mut AnyObject = msg_send![class!(NSEvent), eventWithCGEvent: ev as *mut OpaqueCGEvent];
        if ns.is_null() {
            return None;
        }
        let subtype: i16 = msg_send![ns, subtype];
        if subtype != MEDIA_SUBTYPE {
            return None;
        }
        let data1: isize = msg_send![ns, data1];
        let code = ((data1 as u64 & 0xFFFF_0000) >> 16) as u8;
        let flags = data1 as u64 & 0xFFFF;
        let state = (flags & 0xFF00) >> 8;
        Some(MediaKey { code, down: state == 0xA, repeat: flags & 1 == 1 })
    })
}

/// Build a media key CGEvent (+1 retained; caller releases).
pub fn media_key_event(code: u8, down: bool) -> Option<CGEventRef> {
    autoreleasepool(|_| unsafe {
        let state: isize = if down { 0xA } else { 0xB };
        let data1: isize = ((code as isize) << 16) | (state << 8);
        let ns: *mut AnyObject = msg_send![
            class!(NSEvent),
            otherEventWithType: NS_SYSTEM_DEFINED,
            location: NSPoint(CGPoint::default()),
            modifierFlags: (state as usize) << 8,
            timestamp: 0.0f64,
            windowNumber: 0isize,
            context: std::ptr::null_mut::<AnyObject>(),
            subtype: MEDIA_SUBTYPE,
            data1: data1,
            data2: -1isize
        ];
        if ns.is_null() {
            return None;
        }
        let cg: *mut OpaqueCGEvent = msg_send![ns, CGEvent];
        if cg.is_null() {
            return None;
        }
        core_foundation_sys::base::CFRetain(cg as _);
        Some(cg as CGEventRef)
    })
}

/// Bundle id of the frontmost app, or "" if unknown.
pub fn frontmost_app() -> String {
    autoreleasepool(|_| unsafe {
        let ws: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
        if ws.is_null() {
            return String::new();
        }
        let app: *mut AnyObject = msg_send![ws, frontmostApplication];
        if app.is_null() {
            return String::new();
        }
        let id: *mut AnyObject = msg_send![app, bundleIdentifier];
        if id.is_null() {
            return String::new();
        }
        let s: *const c_char = msg_send![id, UTF8String];
        if s.is_null() { String::new() } else { CStr::from_ptr(s).to_string_lossy().into_owned() }
    })
}

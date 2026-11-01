//! IOHIDManager side: find the Relacon, collect the registry IDs of its IOHID
//! services (for CGEvent sender-ID attribution), and keep its latest input values
//! (for the HID-correlation fallback). We never seize the device.

use crate::config::Button;
use crate::ffi::*;
use core_foundation::base::TCFType;
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_foundation_sys::array::{CFArrayGetCount, CFArrayGetValueAtIndex, CFArrayRef};
use core_foundation_sys::base::{CFRelease, CFRetain};
use std::collections::HashMap;
use std::ffi::{CStr, c_char};

pub const VENDOR_ID: i32 = 1390;
pub const PRODUCT_ID: i32 = 342;

pub const PAGE_GENERIC_DESKTOP: u32 = 0x01;
pub const PAGE_BUTTON: u32 = 0x09;
pub const PAGE_CONSUMER: u32 = 0x0C;

pub const SCROLL_USAGES: [(u32, u32); 2] = [(PAGE_GENERIC_DESKTOP, 0x38), (PAGE_CONSUMER, 0x238)];
pub const MOTION_USAGES: [(u32, u32); 2] = [(PAGE_GENERIC_DESKTOP, 0x30), (PAGE_GENERIC_DESKTOP, 0x31)];

/// How recent a HID value must be to correlate with a CG event.
pub const CORRELATION_WINDOW_NS: u64 = 60_000_000;

pub struct Device {
    pub dev: IOHIDDeviceRef,
    pub name: String,
    /// Registry entry IDs of the device and every IOService below it.
    pub ids: Vec<u64>,
    /// Human-readable "0xID ClassName" for diagnostics.
    pub id_names: Vec<String>,
    elements: HashMap<(u32, u32), Vec<IOHIDElementRef>>,
    elements_array: CFArrayRef,
}

impl Drop for Device {
    fn drop(&mut self) {
        unsafe {
            if !self.elements_array.is_null() {
                CFRelease(self.elements_array as _);
            }
            CFRelease(self.dev as _);
        }
    }
}

#[derive(Default)]
pub struct Hid {
    pub manager: Option<IOHIDManagerRef>,
    pub devices: Vec<Device>,
    /// Latest value per (page, usage) seen in the input-value callback: (value, ns).
    pub last: HashMap<(u32, u32), (i64, u64)>,
}

/// The HID usages that produce a given Relacon button.
pub fn usages_for(b: Button) -> &'static [(u32, u32)] {
    match b {
        Button::Left => &[(PAGE_BUTTON, 1)],
        Button::Right => &[(PAGE_BUTTON, 2)],
        Button::Wheel => &[(PAGE_BUTTON, 3)],
        Button::Back => &[(PAGE_BUTTON, 4)],
        Button::Forward => &[(PAGE_BUTTON, 5)],
        Button::VolUp => &[(PAGE_CONSUMER, 0xE9)],
        Button::VolDown => &[(PAGE_CONSUMER, 0xEA)],
        Button::Play => &[(PAGE_CONSUMER, 0xCD), (PAGE_CONSUMER, 0xB0)],
        Button::Next => &[(PAGE_CONSUMER, 0xB5), (PAGE_CONSUMER, 0xB3)],
        Button::Prev => &[(PAGE_CONSUMER, 0xB6), (PAGE_CONSUMER, 0xB4)],
    }
}

pub fn usage_name(page: u32, usage: u32) -> String {
    let known = match (page, usage) {
        (PAGE_GENERIC_DESKTOP, 0x30) => "X",
        (PAGE_GENERIC_DESKTOP, 0x31) => "Y",
        (PAGE_GENERIC_DESKTOP, 0x38) => "wheel",
        (PAGE_CONSUMER, 0x238) => "AC Pan (horizontal scroll)",
        (PAGE_CONSUMER, 0xE9) => "volume increment",
        (PAGE_CONSUMER, 0xEA) => "volume decrement",
        (PAGE_CONSUMER, 0xE2) => "mute",
        (PAGE_CONSUMER, 0xCD) => "play/pause",
        (PAGE_CONSUMER, 0xB0) => "play",
        (PAGE_CONSUMER, 0xB5) => "scan next track",
        (PAGE_CONSUMER, 0xB6) => "scan previous track",
        (PAGE_CONSUMER, 0xB3) => "fast forward",
        (PAGE_CONSUMER, 0xB4) => "rewind",
        (PAGE_BUTTON, n) => return format!("button {n}"),
        _ => return String::new(),
    };
    known.to_string()
}

pub fn button_for_usage(page: u32, usage: u32) -> Option<Button> {
    Button::ALL.into_iter().find(|b| usages_for(*b).contains(&(page, usage)))
}

pub fn create_manager(
    on_match: IOHIDDeviceCallback,
    on_remove: IOHIDDeviceCallback,
    on_value: IOHIDValueCallback,
) -> IOHIDManagerRef {
    unsafe {
        let manager = IOHIDManagerCreate(std::ptr::null(), kIOHIDOptionsTypeNone);
        let matching = CFDictionary::from_CFType_pairs(&[
            (CFString::new("VendorID"), CFNumber::from(VENDOR_ID)),
            (CFString::new("ProductID"), CFNumber::from(PRODUCT_ID)),
        ]);
        IOHIDManagerSetDeviceMatching(manager, matching.as_concrete_TypeRef() as _);
        IOHIDManagerRegisterDeviceMatchingCallback(manager, on_match, std::ptr::null_mut());
        IOHIDManagerRegisterDeviceRemovalCallback(manager, on_remove, std::ptr::null_mut());
        IOHIDManagerRegisterInputValueCallback(manager, on_value, std::ptr::null_mut());
        IOHIDManagerScheduleWithRunLoop(
            manager,
            core_foundation_sys::runloop::CFRunLoopGetCurrent(),
            core_foundation_sys::runloop::kCFRunLoopDefaultMode,
        );
        manager
    }
}

fn registry_id(entry: io_object_t) -> u64 {
    let mut id = 0u64;
    unsafe { IORegistryEntryGetRegistryEntryID(entry, &mut id) };
    id
}

fn class_name(entry: io_object_t) -> String {
    let mut buf = [0 as c_char; 128];
    unsafe {
        IOObjectGetClass(entry, buf.as_mut_ptr());
        CStr::from_ptr(buf.as_ptr()).to_string_lossy().into_owned()
    }
}

pub fn device_info(dev: IOHIDDeviceRef) -> Device {
    unsafe {
        CFRetain(dev as _);
        let name_ref = IOHIDDeviceGetProperty(dev, CFString::from_static_string("Product").as_concrete_TypeRef());
        let name = if name_ref.is_null() {
            "Relacon".to_string()
        } else {
            CFString::wrap_under_get_rule(name_ref as _).to_string()
        };

        let svc = IOHIDDeviceGetService(dev);
        let mut ids = vec![];
        let mut id_names = vec![];
        if svc != 0 {
            ids.push(registry_id(svc));
            id_names.push(format!("{:#x} {}", registry_id(svc), class_name(svc)));
            let mut iter: io_object_t = 0;
            if IORegistryEntryCreateIterator(svc, c"IOService".as_ptr(), kIORegistryIterateRecursively, &mut iter)
                == kIOReturnSuccess
            {
                loop {
                    let e = IOIteratorNext(iter);
                    if e == 0 {
                        break;
                    }
                    let id = registry_id(e);
                    ids.push(id);
                    id_names.push(format!("{id:#x} {}", class_name(e)));
                    IOObjectRelease(e);
                }
                IOObjectRelease(iter);
            }
        }

        let mut elements: HashMap<(u32, u32), Vec<IOHIDElementRef>> = HashMap::new();
        let arr = IOHIDDeviceCopyMatchingElements(dev, std::ptr::null(), 0);
        if !arr.is_null() {
            for i in 0..CFArrayGetCount(arr) {
                let el = CFArrayGetValueAtIndex(arr, i) as IOHIDElementRef;
                let key = (IOHIDElementGetUsagePage(el), IOHIDElementGetUsage(el));
                elements.entry(key).or_default().push(el);
            }
        }
        Device { dev, name, ids, id_names, elements, elements_array: arr }
    }
}

impl Hid {
    pub fn is_relacon_sender(&self, sender: u64) -> bool {
        sender != 0 && self.devices.iter().any(|d| d.ids.contains(&sender))
    }

    /// Most recent (value, ns) for a usage: the newer of what the callback saw and
    /// what the device reports right now (the callback may not have run yet).
    fn current(&self, key: (u32, u32)) -> Option<(i64, u64)> {
        let mut best = self.last.get(&key).copied();
        for d in &self.devices {
            for el in d.elements.get(&key).into_iter().flatten() {
                let mut v: IOHIDValueRef = std::ptr::null_mut();
                if unsafe { IOHIDDeviceGetValue(d.dev, *el, &mut v) } == kIOReturnSuccess && !v.is_null() {
                    let val = unsafe { IOHIDValueGetIntegerValue(v) } as i64;
                    let ts = mach_to_ns(unsafe { IOHIDValueGetTimeStamp(v) });
                    if best.map(|(_, t)| ts > t).unwrap_or(true) {
                        best = Some((val, ts));
                    }
                }
            }
        }
        best
    }

    pub fn button_pressed(&self, b: Button) -> bool {
        usages_for(b).iter().any(|k| self.current(*k).map(|(v, _)| v != 0).unwrap_or(false))
    }

    /// A non-zero value for any of `usages` within the correlation window.
    pub fn recent(&self, usages: &[(u32, u32)]) -> bool {
        let now = now_ns();
        usages.iter().any(|k| {
            self.current(*k)
                .map(|(v, ts)| v != 0 && now.saturating_sub(ts) < CORRELATION_WINDOW_NS)
                .unwrap_or(false)
        })
    }
}

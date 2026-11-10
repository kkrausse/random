//! Row icons: encoded image bytes (a favicon from the extension, an app icon
//! from AppKit) decoded once into something GPUI can paint.

use std::sync::Arc;

use base64::Engine;
use gpui::RenderImage;
use image::Frame;
use smallvec::SmallVec;

pub type Icon = Arc<RenderImage>;

/// Far above any favicon; keeps a broken sender from making us decode megabytes.
const MAX_BASE64_LEN: usize = 1 << 20;

/// Decodes PNG (or anything else the `image` crate recognises) bytes.
pub fn decode(bytes: &[u8]) -> Option<Icon> {
    let mut pixels = image::load_from_memory(bytes).ok()?.into_rgba8();
    // GPUI paints BGRA.
    for pixel in pixels.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    Some(Arc::new(RenderImage::new(SmallVec::from_elem(
        Frame::new(pixels),
        1,
    ))))
}

pub fn decode_base64(encoded: &str) -> Option<Icon> {
    if encoded.len() > MAX_BASE64_LEN {
        return None;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()?;
    decode(&bytes)
}

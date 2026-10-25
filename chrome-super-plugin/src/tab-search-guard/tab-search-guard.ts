// Keep Tab Search Shortcut: runs in the page's MAIN world at document_start
// in every frame, and stops sites from swallowing Chrome's Tab Search
// shortcut (Ctrl+Shift+A, or Command+Shift+A on macOS).
//
// It catches the key in the capture phase on window, before any page
// handler, and stops propagation without calling preventDefault(), so page
// code never sees it while Chrome still runs its own command.
(() => {
  const PROTECTED_EVENT_TYPES = ["keydown", "keypress", "keyup"];

  // Set this to false to protect only the Ctrl variant.
  const PROTECT_META_SHIFT_A = true;

  // A newer copy (re-injected after an extension reload or when the feature
  // is switched back on) replaces any older one; the background also fires
  // this event to switch the guard off in open tabs.
  const TEARDOWN_EVENT = "super-extension:tab-search-guard:teardown";
  window.dispatchEvent(new Event(TEARDOWN_EVENT));

  const isProtectedShortcut = (event: KeyboardEvent) => {
    if (event.altKey || !event.shiftKey) return false;
    const hasProtectedModifier = event.ctrlKey || (PROTECT_META_SHIFT_A && event.metaKey);
    if (!hasProtectedModifier) return false;
    return event.key?.toLowerCase() === "a" || event.code === "KeyA";
  };

  const keepShortcutForChrome = (event: Event) => {
    if (!isProtectedShortcut(event as KeyboardEvent)) return;
    // Stop page handlers from seeing the shortcut, but do not cancel it.
    // Leaving defaultPrevented false lets Chrome handle its own command.
    event.stopImmediatePropagation();
    event.stopPropagation();
  };

  const listeners = new AbortController();
  for (const type of PROTECTED_EVENT_TYPES) {
    window.addEventListener(type, keepShortcutForChrome, { capture: true, passive: true, signal: listeners.signal });
  }
  window.addEventListener(TEARDOWN_EVENT, () => listeners.abort(), { signal: listeners.signal });
})();

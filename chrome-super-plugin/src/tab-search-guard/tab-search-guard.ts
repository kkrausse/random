(() => {
  "use strict";

  const PROTECTED_EVENT_TYPES = ["keydown", "keypress", "keyup"];

  // Chrome uses Ctrl+Shift+A on Windows/Linux and Command+Shift+A on macOS.
  // Set this to false if you only want to protect the Ctrl variant.
  const PROTECT_META_SHIFT_A = true;

  const isProtectedShortcut = (event) => {
    if (event.altKey || !event.shiftKey) {
      return false;
    }

    const hasProtectedModifier =
      event.ctrlKey || (PROTECT_META_SHIFT_A && event.metaKey);

    if (!hasProtectedModifier) {
      return false;
    }

    return event.key?.toLowerCase() === "a" || event.code === "KeyA";
  };

  const keepShortcutForChrome = (event) => {
    if (!isProtectedShortcut(event)) {
      return;
    }

    // Stop page handlers from seeing the shortcut, but do not cancel it.
    // Leaving defaultPrevented as false lets Chrome handle its own command.
    event.stopImmediatePropagation();
    event.stopPropagation();
  };

  const installGuard = (target) => {
    for (const type of PROTECTED_EVENT_TYPES) {
      target.addEventListener(type, keepShortcutForChrome, {
        capture: true,
        passive: true
      });
    }
  };

  installGuard(window);
})();

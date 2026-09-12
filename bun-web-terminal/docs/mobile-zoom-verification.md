# Mobile keyboard zoom fix (2026-09-11)

## Diagnosis and changes

`installMobileControls` assigned the hidden textarea a 16px font once, but
`ImeOverlay.position` subsequently replaced it with the configured terminal
font size on cursor/IME updates. A size below 16px permits iOS focus auto-zoom.
The input now has a 16px minimum on every IME positioning update; visible
terminal text and composition preedit keep their configured font sizes.

The viewport handler also previously returned whenever `visualViewport.scale`
was not exactly 1. Keyboard close/open or rotation while zoomed could therefore
leave an old body height/top in place. It now uses `height * scale` to keep
unzoomed layout dimensions current, following viewport top offsets only near
normal scale so pinch panning stays browser-owned. Viewport events are coalesced
per animation frame; focus changes and page restoration also schedule layout.
The fixed terminal page has an explicit initial top/left origin.

## Checks

- `bun-web-terminal`: typecheck passed; 42 tests passed, one tmux integration
  test timed out at `src/sessions.test.ts:54`. The same timeout reproduced in
  a clean `git archive HEAD` baseline with a fresh frozen dependency install.
- `ghostty-web`: typecheck and all 10 IME tests passed, including small-font
  cursor updates, unchanged preedit sizing, composition, and clipboard anchors.
- New viewport tests cover keyboard open/close, rotation, pinch zoom, and the
  fallback without VisualViewport.
- Browser Control CLI 0.7.0 against a separate server/build on port 3107 and a
  newly created disposable tmux session: repeated viewport height changes restored
  body/canvas sizing, with a computed textarea font of 16px after terminal input.
- Chromium mobile emulation at 390px width / DPR 3: body height stayed 844px
  when scale changed 1 → 1.5 (visual height 562.67px). At scale 1.5, shrinking
  available height to 430px gave body height 430px and canvas height 375px.
  Restoring height and scale returned body/canvas heights to 844/780px.
- Keyboard toggle logic focused and blurred the input via DOM clicks. A trusted
  toolbar click hit a browser zoom/emulation coordinate problem recorded in
  `../browser-control-todo.md`; it is not evidence of real keyboard operation.

## Phone follow-up

Desktop Chromium emulation cannot reproduce iOS automatic focus zoom or a real
software keyboard. On the target phone, restart/rebuild the server, sign in,
and reload the terminal. With a terminal font below 16px, type enough to move
the cursor, repeatedly toggle the keyboard, dismiss it with the system control,
rotate while open, and return from a background tab. Check that text size is
stable and the toolbar returns to the visible bottom. Also pinch zoom and
repeat keyboard open/close; intentional zoom should remain available.

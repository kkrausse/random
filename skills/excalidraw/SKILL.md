---
name: Excalidraw
description: Inspect and edit an Excalidraw scene in the user's attached browser tab through the structured Excalidraw API. Use for reading diagrams, adding or changing elements with exact data, or verifying scene changes without mouse drawing.
---

# Excalidraw

Use Browser Control on the user's attached Excalidraw tab. Prefer the structured
scene API over pointer input, screenshots, DOM scraping, or persistence data.

Use the `browser-control` CLI only — never the claude-in-chrome MCP tools for
this skill. The MCP cannot attach to the user's existing tab (its sibling tab's
shared-scene sync clobbers unsaved edits) and cannot pipe payload files into the
page, forcing element JSON through tool-call text. If `browser-control` is not
on PATH, stop and ask the user to install it instead of falling back.

This project expects Excalidraw sessions to remain editable. Do not create a
read-only session unless the user explicitly requests one.

## Inspect A Diagram

Use the bundled compact inventory for both interpretation and edit planning:

```bash
browser-control execute --json --target-url excalidraw.com \
  --file ./skills/excalidraw/scripts/scene-inspect.js \
  | jq -c '{session: .session.id, value}'
```

This selects and verifies the attached tab, discovers the API, and returns an
edit-ready inventory of every live element. Compact row formats preserve IDs,
geometry, text, style, grouping, bindings, and connector points without dumping
large raw Excalidraw objects. It also includes bounds, viewport, and file count.

The CLI currently requires `--json` when using `--file`; the `jq` filter keeps
one value copy plus the continuation session ID. Do not return the complete
elements array. After this call, answer the user's question directly instead
of reporting only that inspection succeeded.

Use a screenshot only when the user asks about visual appearance, alignment,
or aesthetics.

## Export A Diagram

To download the scene as a `.excalidraw` file, use the bundled full exporter
instead of the compact inventory:

```bash
browser-control execute --json --target-url excalidraw.com \
  --file ./skills/excalidraw/scripts/scene-export.js \
  | jq -r '.value' > diagram.excalidraw
```

It returns a complete `{type, version, source, elements, appState, files}`
document: all non-deleted elements verbatim, a minimal appState (grid +
background), and only the files that live image elements reference. The value
is a JSON string, so extract it with `jq -r '.value'`.

## Sessions

A one-shot inspection does not need adoption or a preliminary URL call because
`--target-url` selects the existing tab and the inventory includes its URL.

The one-shot target selection does not make that tab the session default. For
follow-up edits, adopt the tab using the session ID returned by the inventory,
then continue with that session:

```bash
browser-control session adopt --target-url excalidraw.com --session <session-id>
```

When starting an editing session without first running the inventory, do not
assume a named session already exists. Start an editable session with a bare
`browser-control execute`, retain its generated ID, then adopt with that ID:

```bash
browser-control execute 'return page.url()'
browser-control session adopt --target-url excalidraw.com --session <session-id>
```

If a known session already controls the tab, reuse it rather than creating a
new one.

## Find The API

The hosted app usually exposes the official API through an `excalidrawAPI`
React prop rather than directly on `window`. Discover it by the capabilities
`getSceneElements()` and `updateScene()`, never by minified component names or
random React property suffixes.

The canonical capability search is in `scripts/scene-inspect.js`. Reuse its
`findExcalidrawAPI()` function inside each `page.evaluate()` operation that
needs the API. React traversal is an integration fallback, so fail closed if
the capability checks do not pass.

On excalidraw.com the `excalidrawAPI` prop is a callback ref, so the downward
`memoizedProps.excalidrawAPI` search finds a function, not the API object. The
working fallback is upward: read the `__reactFiber$*` key off the `.excalidraw`
DOM node and walk `.return` until a class `stateNode` has `updateScene` and
`scene`. That App instance stands in for the API via a small adapter
(`getSceneElements` → `scene.getNonDeletedElements()`,
`getSceneElementsIncludingDeleted` → `scene.getElementsIncludingDeleted()`);
it has no `scrollToContent`, so zoom-to-fit with the Shift+1 shortcut instead.
Cache the handle on `window` for follow-up calls; it dies on any reload.

## Inspect Precisely

Start with the inventory script. Read a target's complete fresh object before
mutating it when the request needs a field omitted from the compact rows.

Read live data with:

- `getSceneElements()` for current elements
- `getSceneElementsIncludingDeleted()` when preparing an update
- `getAppState()` for viewport or selection state
- `getFiles()` for embedded assets

## Update

Use `updateScene()` for exact edits. Build the complete next element array from
a fresh `getSceneElementsIncludingDeleted()` read, preserve unrelated elements,
and change only intended fields. Set:

```js
{
  ...target,
  ...patch,
  version: target.version + 1,
  versionNonce: Math.floor(Math.random() * 2 ** 31),
  updated: Date.now(),
}
```

Call `updateScene({ elements, captureUpdate: "IMMEDIATELY" })` so the edit
participates in undo/redo.

For insertion, prefer cloning a live element of the same type as a schema
template. Replace identity, geometry, bindings, grouping, version, and style
fields that should not carry over. Never inherit `boundElements`, `containerId`,
`frameId`, or `groupIds` unintentionally.

Do not use synthetic paste as the normal insertion path. Do not write directly
to `localStorage` or IndexedDB; the mounted app overwrites persistence with its
in-memory scene, and excalidraw.com discards externally written scene storage
even on a fresh page load.

## Insert A Diagram

To upload many new elements, do not inline full element JSON — most fields are
boilerplate. Pass compact specs and expand them in-page with a defaults helper
(`scripts/scene-upload.js`): a skeleton with id, type, geometry, text, colors,
and (for arrows) points and bindings is enough; `updateScene` tolerates missing
cosmetic fields and recomputes bound-text layout. The binding contract:

- a labeled container has `boundElements: [{type: "text", id}]` and the text
  element has `containerId` pointing back
- an arrow carries `startBinding`/`endBinding` `{elementId, focus: 0, gap: 4}`
  and each bound shape lists the arrow in its `boundElements`

## Persist

On excalidraw.com, `updateScene()` alone does not run the app's save path — a
reload loses the entire push. After updating, drive one real edit through the
input pipeline (select an element, press ArrowRight then ArrowLeft), wait past
the debounce (over a second), then confirm the save landed: the `excalidraw`
localStorage key holds the elements and the `version-dataState` timestamp
bumps.

All excalidraw.com tabs in a browser profile share one scene. Another open tab
— an idle empty one, or a Reset clicked there — replaces your in-memory work on
its next sync. Have the user close other excalidraw tabs before editing.

## Verify

Treat an update call as an attempt, not proof. Read the scene again through the
API and assert the requested values. After persistence has had time to run,
make a fresh Browser Control call and verify again.

For destructive or broad edits, first identify exact target IDs and obtain user
approval. Afterward, verify both the intended changes and that unrelated IDs or
counts did not change.

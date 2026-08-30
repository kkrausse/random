---
name: Excalidraw
description: Inspect and edit an Excalidraw scene in the user's attached browser tab through the structured Excalidraw API. Use for reading diagrams, adding or changing elements with exact data, or verifying scene changes without mouse drawing.
---

# Excalidraw

Use Browser Control to operate the user's attached Excalidraw tab. Load the
`browser-control` skill first and follow its inspect, act, verify loop.

Prefer structured scene data over pointer or keyboard drawing. Do not take a
screenshot unless the user asks for visual or aesthetic analysis. For ordinary
inspection, summarize `getSceneElements()`, `getAppState()`, and `getFiles()`.

## Attach

Select or adopt the existing Excalidraw tab. Adoption is preferable for a
multi-step editing session.

```bash
browser-control session adopt --target-url excalidraw.com --session excalidraw
```

Confirm the selected page before reading or editing it.

```bash
browser-control execute --json --session excalidraw \
  'return { url: page.url(), title: await page.title() }'
```

## Find The API

On an application that embeds Excalidraw, first inspect `window` for an API
reference exposing both `getSceneElements()` and `updateScene()`.

The hosted `excalidraw.com` app currently does not publish that reference on
`window`. It does pass the official API object through an `excalidrawAPI` React
prop. Locate it by capabilities, not minified component names or React's random
property suffixes.

Run this inside `page.evaluate()` whenever an operation needs the API:

```js
function findExcalidrawAPI() {
  for (const key of Object.getOwnPropertyNames(window)) {
    let value
    try {
      value = window[key]
    } catch {
      continue
    }
    if (
      value &&
      typeof value === "object" &&
      typeof value.getSceneElements === "function" &&
      typeof value.updateScene === "function"
    ) {
      return value
    }
  }

  const root = document.querySelector("#root")
  const rootKey = root && Object.getOwnPropertyNames(root)
    .find((key) => key.startsWith("__reactContainer$"))
  const reactRoot = rootKey ? root[rootKey] : null
  const start = reactRoot?.current ?? reactRoot
  const seen = new Set()
  const stack = start ? [start] : []

  while (stack.length) {
    const fiber = stack.pop()
    if (!fiber || seen.has(fiber)) continue
    seen.add(fiber)

    const api = fiber.memoizedProps?.excalidrawAPI
    if (
      api &&
      typeof api.getSceneElements === "function" &&
      typeof api.updateScene === "function"
    ) {
      return api
    }

    if (fiber.child) stack.push(fiber.child)
    if (fiber.sibling) stack.push(fiber.sibling)
  }

  throw new Error("Excalidraw API not found")
}
```

The React traversal is an integration fallback, not an official Excalidraw
contract. Fail closed if the capability checks do not pass.

## Inspect

Read the official API and return bounded, task-relevant data. Avoid returning a
large scene verbatim unless the user requests an export.

```js
return await page.evaluate(() => {
  const api = findExcalidrawAPI()
  const elements = api.getSceneElements()
  const appState = api.getAppState()

  return {
    elementCount: elements.length,
    typeCounts: elements.reduce((counts, element) => {
      counts[element.type] = (counts[element.type] || 0) + 1
      return counts
    }, {}),
    elements: elements.map(({ id, type, x, y, width, height, frameId, groupIds }) => ({
      id,
      type,
      x,
      y,
      width,
      height,
      frameId,
      groupIds,
    })),
    viewport: {
      scrollX: appState.scrollX,
      scrollY: appState.scrollY,
      zoom: appState.zoom,
    },
    fileCount: Object.keys(api.getFiles()).length,
  }
})
```

Include text values only when needed to understand or locate the requested
diagram content.

## Update

Use `updateScene()` for exact edits. Build the complete next element array from
a fresh read, preserve unrelated elements, and change only the intended fields.
Use `captureUpdate: "IMMEDIATELY"` so a local edit participates in undo/redo.

```js
const result = await page.evaluate(({ targetId, patch }) => {
  const api = findExcalidrawAPI()
  const before = api.getSceneElementsIncludingDeleted()
  const target = before.find((element) => element.id === targetId)
  if (!target || target.isDeleted) {
    throw new Error(`Live element not found: ${targetId}`)
  }

  const replacement = {
    ...target,
    ...patch,
    version: target.version + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now(),
  }

  api.updateScene({
    elements: before.map((element) =>
      element.id === targetId ? replacement : element
    ),
    captureUpdate: "IMMEDIATELY",
  })

  const current = api.getSceneElements().find((element) => element.id === targetId)
  return current && {
    id: current.id,
    type: current.type,
    x: current.x,
    y: current.y,
    width: current.width,
    height: current.height,
    version: current.version,
  }
}, {
  targetId: "element-id",
  patch: { x: 40, y: 1250, width: 240, height: 120 },
})
```

For insertion, construct a schema-valid element, append it to a fresh
`getSceneElementsIncludingDeleted()` result, and call `updateScene()` once.
Prefer cloning a live element of the same type as the schema template, then
replace every identity, geometry, binding, grouping, version, and style field
that should not be inherited. Never inherit `boundElements`, `containerId`,
`frameId`, or `groupIds` unintentionally.

Do not use synthetic paste as the normal insertion path. Excalidraw treats
pasted elements as imports and may regenerate IDs or reposition them around the
viewport.

## Verify

Treat the mutation call as an attempt, not proof. Read the scene again through
the API and assert the exact requested values. After persistence has had time
to run, make a fresh Browser Control call and verify the element again through
the API. Use local persistence only as a secondary diagnostic.

For destructive or broad edits, first return exact target IDs and obtain user
approval. After updating, verify both the intended changes and that unrelated
element counts or IDs did not change.

## Fallback Order

1. A capability-matched API reference already exposed on `window`.
2. The official `excalidrawAPI` object found in React component props.
3. An internal component instance exposing equivalent scene methods, only if
   the official API prop cannot be found.
4. `localStorage` or IndexedDB for inspection and recovery diagnostics only.

Directly writing `localStorage` is not a live editing mechanism. The mounted
app can overwrite it with its in-memory scene during autosave or navigation.

## Capturing The Reference

For an app we control, capture the API through Excalidraw's official callback:

```tsx
<Excalidraw excalidrawAPI={(api) => setExcalidrawAPI(api)} />
```

For `excalidraw.com`, the app owns its React render, so startup interception is
not an official integration point. A Browser Control init script could wait for
the React root and assign the discovered object to a private `window` property,
but this remains dependent on React internals and offers little benefit over
running `findExcalidrawAPI()` on demand. Prefer on-demand discovery and cache
the reference only within one `page.evaluate()` operation.

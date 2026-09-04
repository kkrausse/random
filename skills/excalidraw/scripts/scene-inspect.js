return await page.evaluate(() => {
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

    // excalidraw.com passes excalidrawAPI as a callback ref, so the prop
    // search above finds a function there. Walk up from the .excalidraw DOM
    // node to the App class instance and adapt it.
    const mount = document.querySelector(".excalidraw")
    const fiberKey = mount && Object.getOwnPropertyNames(mount)
      .find((key) => key.startsWith("__reactFiber$"))
    let node = fiberKey ? mount[fiberKey] : null
    let hops = 0
    while (node && hops < 200) {
      const app = node.stateNode
      if (
        app &&
        typeof app.updateScene === "function" &&
        app.scene &&
        typeof app.scene.getNonDeletedElements === "function"
      ) {
        return {
          getSceneElements: () => app.scene.getNonDeletedElements(),
          getSceneElementsIncludingDeleted: () =>
            app.scene.getElementsIncludingDeleted(),
          getAppState: () => app.state,
          getFiles: () => app.files ?? {},
          updateScene: (payload) => app.updateScene(payload),
          // no scrollToContent on the App instance; use the Shift+1 shortcut
        }
      }
      node = node.return
      hops += 1
    }

    throw new Error("Excalidraw API not found")
  }

  const api = findExcalidrawAPI()
  const elements = api.getSceneElements()
  const appState = api.getAppState()
  const round = (value) => Math.round(value)
  const typeCounts = {}

  for (const element of elements) {
    typeCounts[element.type] = (typeCounts[element.type] || 0) + 1
  }

  const bounds = elements.length === 0 ? null : {
    x: round(Math.min(...elements.map((element) => element.x))),
    y: round(Math.min(...elements.map((element) => element.y))),
    width: round(
      Math.max(...elements.map((element) => element.x + element.width)) -
      Math.min(...elements.map((element) => element.x)),
    ),
    height: round(
      Math.max(...elements.map((element) => element.y + element.height)) -
      Math.min(...elements.map((element) => element.y)),
    ),
  }

  const textElements = elements
    .filter((element) => element.type === "text")
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((element) => [
      element.id,
      round(element.x),
      round(element.y),
      round(element.width),
      round(element.height),
      element.text,
      element.strokeColor,
      element.fontSize,
      element.fontFamily,
      element.textAlign,
      element.containerId,
      element.frameId,
      element.groupIds,
    ])

  const shapes = elements
    .filter((element) => !["text", "arrow", "line"].includes(element.type))
    .map((element) => [
      element.id,
      element.type,
      round(element.x),
      round(element.y),
      round(element.width),
      round(element.height),
      element.strokeColor,
      element.backgroundColor,
      element.fillStyle,
      element.strokeStyle,
      element.roughness,
      element.opacity,
      element.frameId,
      element.groupIds,
      element.boundElements,
    ])

  const connectors = elements
    .filter((element) => ["arrow", "line"].includes(element.type))
    .map((element) => {
      return [
        element.id,
        element.type,
        round(element.x),
        round(element.y),
        element.points.map(([x, y]) => [round(x), round(y)]),
        element.strokeColor,
        element.strokeStyle,
        element.roughness,
        element.opacity,
        element.startBinding,
        element.endBinding,
        element.frameId,
        element.groupIds,
      ]
    })

  return {
    url: location.href,
    title: document.title,
    elementCount: elements.length,
    typeCounts,
    bounds,
    textColumns: [
      "id", "x", "y", "width", "height", "text", "stroke", "fontSize",
      "fontFamily", "align", "containerId", "frameId", "groupIds",
    ],
    textElements,
    shapeColumns: [
      "id", "type", "x", "y", "width", "height", "stroke", "background",
      "fillStyle", "strokeStyle", "roughness", "opacity", "frameId",
      "groupIds", "boundElements",
    ],
    shapes,
    connectorColumns: [
      "id", "type", "x", "y", "points", "stroke", "strokeStyle",
      "roughness", "opacity", "startBinding", "endBinding", "frameId",
      "groupIds",
    ],
    connectors,
    viewport: {
      scrollX: round(appState.scrollX),
      scrollY: round(appState.scrollY),
      zoom: appState.zoom.value,
    },
    fileCount: Object.keys(api.getFiles()).length,
  }
})

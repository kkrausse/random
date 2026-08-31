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
          getAppState: () => app.state,
          getFiles: () => app.files ?? {},
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
  const files = api.getFiles()

  const usedFileIds = new Set(
    elements.filter((el) => el.fileId).map((el) => el.fileId)
  )
  const keptFiles = {}
  for (const [id, file] of Object.entries(files)) {
    if (usedFileIds.has(id)) keptFiles[id] = file
  }

  return JSON.stringify(
    {
      type: "excalidraw",
      version: 2,
      source: "https://excalidraw.com",
      elements,
      appState: {
        gridSize: appState.gridSize ?? null,
        gridStep: appState.gridStep ?? 5,
        gridModeEnabled: appState.gridModeEnabled ?? false,
        viewBackgroundColor: appState.viewBackgroundColor ?? "#ffffff",
      },
      files: keptFiles,
    },
    null,
    2
  )
})

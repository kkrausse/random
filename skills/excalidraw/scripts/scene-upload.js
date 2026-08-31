// Insert a diagram from compact specs, expanded to full elements in-page.
// Edit SPECS instead of inlining full element JSON — every other field is
// boilerplate the defaults below cover. Spec kinds:
//   { kind: "box",   id, x, y, w, h, text?, bg?, stroke?, fontSize?, dashed? }
//   { kind: "label", id, x, y, text, fontSize?, color? }
//   { kind: "arrow", id, from?, to?, points: [[x,y],...] (absolute),
//     label?, dashed? }   // from/to are box ids to bind to
return await page.evaluate(() => {
  const SPECS = [
    // { kind: "box", id: "svc", x: 80, y: 100, w: 300, h: 70,
    //   text: "my-service\nrole", bg: "#a5d8ff", stroke: "#1971c2" },
    // { kind: "arrow", id: "a1", from: "svc", to: "db",
    //   points: [[230, 170], [230, 230]], label: "writes" },
  ]

  function findExcalidrawAPI() {
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
          updateScene: (payload) => app.updateScene(payload),
        }
      }
      node = node.return
      hops += 1
    }
    throw new Error("Excalidraw API not found")
  }

  const rand = () => Math.floor(Math.random() * 2 ** 31)
  function base(id, type, x, y, w, h, extra) {
    return {
      id, type, x, y, width: w, height: h,
      angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent",
      fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1,
      opacity: 100, groupIds: [], frameId: null, roundness: null,
      seed: rand(), version: 1, versionNonce: rand(), isDeleted: false,
      boundElements: null, updated: Date.now(), link: null, locked: false,
      ...extra,
    }
  }
  function textEl(id, x, y, text, fontSize, extra) {
    const lines = text.split("\n")
    const w = Math.max(...lines.map((l) => l.length)) * fontSize * 0.55
    const h = lines.length * fontSize * 1.25
    return base(id, "text", x, y, w, h, {
      text, originalText: text, fontSize, fontFamily: 1,
      textAlign: "center", verticalAlign: "middle", containerId: null,
      autoResize: true, lineHeight: 1.25, ...extra,
    })
  }

  const out = []
  const boxes = {}
  for (const s of SPECS) {
    if (s.kind === "box") {
      const rect = base(s.id, "rectangle", s.x, s.y, s.w, s.h, {
        backgroundColor: s.bg ?? "transparent",
        strokeColor: s.stroke ?? "#1e1e1e",
        strokeStyle: s.dashed ? "dashed" : "solid",
        roundness: { type: 3 }, boundElements: [],
      })
      boxes[s.id] = rect
      out.push(rect)
      if (s.text) {
        const t = textEl(s.id + "-txt", s.x + 10, s.y + 10, s.text,
          s.fontSize ?? 15, { containerId: s.id })
        rect.boundElements.push({ type: "text", id: t.id })
        out.push(t)
      }
    } else if (s.kind === "label") {
      out.push(textEl(s.id, s.x, s.y, s.text, s.fontSize ?? 18, {
        textAlign: "left", verticalAlign: "top",
        strokeColor: s.color ?? "#1e1e1e",
      }))
    } else if (s.kind === "arrow") {
      const [x0, y0] = s.points[0]
      const rel = s.points.map(([px, py]) => [px - x0, py - y0])
      const xs = rel.map((p) => p[0])
      const ys = rel.map((p) => p[1])
      const arrow = base(s.id, "arrow", x0, y0,
        Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), {
          strokeColor: "#495057",
          strokeStyle: s.dashed ? "dashed" : "solid",
          points: rel, lastCommittedPoint: null,
          startBinding: s.from
            ? { elementId: s.from, focus: 0, gap: 4 } : null,
          endBinding: s.to ? { elementId: s.to, focus: 0, gap: 4 } : null,
          startArrowhead: null, endArrowhead: "arrow",
          boundElements: [], elbowed: false,
        })
      for (const ref of [s.from, s.to]) {
        if (ref && boxes[ref]) {
          boxes[ref].boundElements.push({ id: s.id, type: "arrow" })
        }
      }
      out.push(arrow)
      if (s.label) {
        const mid = s.points[Math.floor(s.points.length / 2)]
        const t = textEl(s.id + "-lbl", mid[0], mid[1], s.label, 13, {
          containerId: s.id, strokeColor: "#343a40",
        })
        arrow.boundElements.push({ type: "text", id: t.id })
        out.push(t)
      }
    }
  }

  const api = findExcalidrawAPI()
  const existing = api.getSceneElementsIncludingDeleted()
  api.updateScene({
    elements: existing.concat(out),
    captureUpdate: "IMMEDIATELY",
  })
  // Not persisted yet: drive one real edit (select + arrow-key nudge) and
  // verify per SKILL.md's Persist section.
  return { added: out.length, total: api.getSceneElements().length }
})

// html-canvas runtime: lays <hc-frame>s out on a pan/zoom canvas and draws
// arrows between them from declared refs. No build step, no dependencies.
//
// Authoring format (see ../SKILL.md for the full reference):
//
//   <hc-canvas title="..." device="phone">
//     <hc-row title="Onboarding">
//       <hc-frame id="welcome" title="First run">
//         <button data-id="find" data-to="nearby">Find camera</button>
//       </hc-frame>
//       <hc-frame id="nearby" to="pair" label="tapped Connect">...</hc-frame>
//       <hc-note to="nearby.list">Only shows cameras in pairing mode</hc-note>
//     </hc-row>
//     <hc-flow from="pair" to="welcome" label="cancelled" dashed></hc-flow>
//   </hc-canvas>
//
// Refs are `frameId` or `frameId.dataId`. Layout is document order (rows are
// flex rows, hc-col stacks), so nothing in the source carries coordinates
// except the optional `offset="dx,dy"` a human adds by dragging.
(() => {
  const DEVICES = {
    phone: [390, 844],
    'phone-sm': [375, 667],
    tablet: [820, 1180],
    desktop: [1280, 800],
    watch: [198, 242],
  }
  const ACCENT = '#1971c2'

  const STYLES = `
html, body { margin: 0; height: 100%; }
body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #1e1e1e; }
hc-canvas { position: fixed; inset: 0; overflow: hidden; display: block; touch-action: none;
  background: #f4f5f7 radial-gradient(#d5d8dc 1px, transparent 1px) 0 0 / 24px 24px; cursor: grab; }
hc-canvas.hc-panning { cursor: grabbing; }
.hc-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; width: max-content;
  display: flex; flex-direction: column; gap: 140px; padding: 80px; user-select: none; -webkit-user-select: none; }
.hc-heading { font-size: 34px; font-weight: 700; margin-bottom: -30px; }
hc-row { display: flex; flex-direction: row; align-items: flex-start; gap: 160px; position: relative; }
hc-col { display: flex; flex-direction: column; align-items: flex-start; gap: 100px; }
hc-row[title]::before { content: attr(title); position: absolute; top: -78px; left: 0;
  font-size: 22px; font-weight: 600; color: #868e96; white-space: nowrap; }
hc-flow { display: none; }
hc-frame { display: block; position: relative; flex: none; }
.hc-label { position: absolute; bottom: 100%; left: 2px; padding-bottom: 8px; white-space: nowrap;
  font-size: 15px; font-weight: 600; cursor: move; }
.hc-label code { font: 12px ui-monospace, monospace; color: #868e96; margin-right: 6px; font-weight: 400; }
.hc-screen { display: flex; flex-direction: column; position: relative; overflow: hidden; box-sizing: border-box;
  background: #fff; border: 2px solid #1e1e1e; border-radius: 12px; font-size: 15px; line-height: 1.35; cursor: default; }
hc-frame[device^="phone"] > .hc-screen, hc-frame[device="watch"] > .hc-screen { border-radius: 36px; }
hc-note { display: block; flex: none; max-width: 260px; padding: 8px 10px; font-size: 14px; line-height: 1.35;
  color: ${ACCENT}; border: 1px dashed ${ACCENT}; border-radius: 8px; background: #e7f5ff; cursor: move; white-space: pre-line; }
.hc-edges { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
.hc-edges path.hc-edge { fill: none; stroke: ${ACCENT}; stroke-width: 2; pointer-events: stroke; cursor: pointer; }
.hc-edges path.hc-edge:hover { stroke-width: 4; }
.hc-edges path.hc-dashed { stroke-dasharray: 7 6; }
.hc-edges text { font-size: 13px; fill: ${ACCENT}; paint-order: stroke; stroke: #fff; stroke-width: 5px; stroke-linejoin: round;
  text-anchor: middle; dominant-baseline: middle; }
.hc-hud { position: fixed; left: 12px; bottom: 12px; display: flex; gap: 8px; align-items: center; z-index: 10;
  font: 12px ui-monospace, monospace; color: #495057; background: #fff; border: 1px solid #dee2e6; border-radius: 8px; padding: 6px 10px; }
.hc-hud button { font: inherit; border: 1px solid #ced4da; background: #fff; border-radius: 5px; padding: 1px 7px; cursor: pointer; }
.hc-errors { position: fixed; left: 12px; top: 12px; z-index: 10; max-width: 60vw; white-space: pre-wrap;
  font: 12px ui-monospace, monospace; color: #c92a2a; background: #fff5f5; border: 1px solid #ffa8a8; border-radius: 8px; padding: 8px 10px; }

/* Wireframe kit: optional low-fi primitives so screens stay terse. It sits in
   Tailwind's own layer order (declared here first so it holds whether or not
   Tailwind loads): above preflight, below utilities, below any plain <style>. */
@layer theme, base, components, utilities;
@layer base { .hc-screen, .hc-screen *, hc-note { box-sizing: border-box; } }
@layer components {
.wf-pad { display: flex; flex-direction: column; gap: 12px; padding: 16px; }
.wf-row { display: flex; flex-direction: row; align-items: center; gap: 8px; }
.wf-col { display: flex; flex-direction: column; gap: 8px; }
.wf-between { justify-content: space-between; }
.wf-center { align-items: center; justify-content: center; text-align: center; }
.wf-status { display: flex; justify-content: space-between; padding: 14px 28px 6px; font-size: 13px; font-weight: 600; flex: none; }
.wf-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 16px; font-weight: 600; flex: none; }
.wf-title { font-size: 28px; font-weight: 700; line-height: 1.15; }
.wf-h { font-size: 18px; font-weight: 600; }
.wf-muted { color: #868e96; font-size: 13px; }
.wf-btn { display: flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; min-height: 44px; padding: 8px 14px;
  border: 1.5px solid #1e1e1e; border-radius: 10px; background: #fff; color: #1e1e1e; font: inherit; font-weight: 500; text-align: center; }
.wf-btn.wf-primary { background: #1e1e1e; color: #fff; }
.wf-btn.wf-ghost { border-color: transparent; color: #495057; min-height: 32px; }
.wf-btn.wf-sm { min-height: 32px; padding: 4px 10px; font-size: 13px; border-radius: 8px; }
.wf-input { display: flex; align-items: center; box-sizing: border-box; min-height: 40px; padding: 6px 10px; border: 1.5px solid #adb5bd; border-radius: 8px; background: #fff; color: #495057; }
.wf-card { box-sizing: border-box; padding: 12px; border: 1.5px solid #ced4da; border-radius: 12px; background: #fff; }
.wf-fill { background: #f1f3f5; }
.wf-list > * { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 16px; border-bottom: 1px solid #e9ecef; }
.wf-img { display: flex; align-items: center; justify-content: center; text-align: center; box-sizing: border-box; color: #868e96; font-size: 13px;
  border: 1.5px solid #ced4da; border-radius: 8px; background: repeating-linear-gradient(135deg, #f1f3f5 0 10px, #e9ecef 10px 20px); }
.wf-chip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border: 1.5px solid #adb5bd; border-radius: 999px; font-size: 13px; background: #fff; }
.wf-chip.wf-on, .wf-seg > .wf-on { background: #1e1e1e; color: #fff; border-color: #1e1e1e; }
.wf-seg { display: flex; border: 1.5px solid #1e1e1e; border-radius: 9px; overflow: hidden; }
.wf-seg > * { flex: 1; text-align: center; padding: 6px 8px; font-size: 13px; }
.wf-toggle { flex: none; width: 46px; height: 28px; border-radius: 999px; background: #ced4da; position: relative; }
.wf-toggle::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; }
.wf-toggle.wf-on { background: #1e1e1e; }
.wf-toggle.wf-on::after { left: 21px; }
.wf-circle { flex: none; width: 64px; height: 64px; border-radius: 50%; border: 2px solid #1e1e1e; display: flex; align-items: center; justify-content: center; box-sizing: border-box; }
.wf-divider { height: 1px; background: #e9ecef; flex: none; }
.wf-tabs { display: flex; flex: none; border-top: 1px solid #dee2e6; padding: 8px 0 22px; }
.wf-tabs > * { flex: 1; text-align: center; font-size: 12px; color: #868e96; }
.wf-tabs > .wf-on { color: #1e1e1e; font-weight: 600; }
.wf-scrim { position: absolute; inset: 0; background: rgba(0,0,0,.35); }
.wf-sheet { position: absolute; left: 0; right: 0; bottom: 0; background: #fff; border-radius: 20px 20px 0 0; padding: 16px 16px 28px;
  display: flex; flex-direction: column; gap: 12px; box-shadow: 0 -4px 24px rgba(0,0,0,.18); }
.wf-dialog { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 72%; background: #fff; border-radius: 16px; padding: 16px;
  display: flex; flex-direction: column; gap: 10px; box-shadow: 0 8px 32px rgba(0,0,0,.25); text-align: center; }
.wf-dark { background: #1e1e1e; color: #fff; }
.wf-grow { flex: 1 1 0; min-height: 0; min-width: 0; }
}
`
  const style = document.createElement('style')
  style.textContent = STYLES
  // Prepend so anything the author writes in <head> overrides the defaults.
  document.head.prepend(style)

  const NS = 'http://www.w3.org/2000/svg'
  const svgEl = (tag, attrs = {}) => {
    const el = document.createElementNS(NS, tag)
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    return el
  }
  const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)))
  const pair = (s) => (s || '').split(',').map((n) => parseFloat(n) || 0)

  function start() {
    const canvas = document.querySelector('hc-canvas')
    if (!canvas) return
    const live = location.protocol.startsWith('http')
    const viewKey = 'hc-view:' + location.pathname
    const view = { x: 0, y: 0, k: 1 }

    // --- DOM setup -------------------------------------------------------
    const world = document.createElement('div')
    world.className = 'hc-world'
    world.append(...canvas.childNodes)
    if (canvas.getAttribute('title')) {
      const h = document.createElement('div')
      h.className = 'hc-heading'
      h.textContent = canvas.getAttribute('title')
      world.prepend(h)
      document.title ||= h.textContent
    }
    canvas.append(world)

    const defaultDevice = canvas.getAttribute('device')
    for (const frame of world.querySelectorAll('hc-frame')) {
      const screen = document.createElement('div')
      screen.className = 'hc-screen'
      screen.append(...frame.childNodes)
      const device = frame.getAttribute('device') || defaultDevice
      if (device && !frame.hasAttribute('device')) frame.setAttribute('device', device)
      const [dw, dh] = DEVICES[device] || []
      const w = frame.getAttribute('w') || dw
      const h = frame.getAttribute('h') || dh
      if (w) screen.style.width = w + 'px'
      if (h) screen.style.height = h + 'px'
      const label = document.createElement('div')
      label.className = 'hc-label'
      const code = document.createElement('code')
      code.textContent = frame.id
      label.append(code, frame.getAttribute('title') || '')
      frame.append(label, screen)
    }
    const nodes = [...world.querySelectorAll('hc-frame, hc-note')]
    const applyOffset = (node) => {
      const [dx, dy] = pair(node.getAttribute('offset'))
      node.style.translate = dx || dy ? `${dx}px ${dy}px` : ''
    }
    nodes.forEach(applyOffset)

    const svg = svgEl('svg', { class: 'hc-edges' })
    const defs = svgEl('defs')
    const marker = svgEl('marker', { id: 'hc-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' })
    marker.append(svgEl('path', { d: 'M0,0 L10,5 L0,10 z', fill: ACCENT }))
    defs.append(marker)
    svg.append(defs)
    world.append(svg)

    const hud = document.createElement('div')
    hud.className = 'hc-hud'
    const zoomText = document.createElement('span')
    const fitBtn = document.createElement('button')
    fitBtn.textContent = 'fit'
    const mode = document.createElement('span')
    mode.textContent = live ? 'live' : 'static (drags not saved)'
    hud.append(zoomText, fitBtn, mode)
    document.body.append(hud)

    // --- Edges -----------------------------------------------------------
    const errors = []
    const nodeOf = (el) => el.closest('hc-frame, hc-note')
    // The box an arrow should touch: a frame's screen (not its label), else the element.
    const boxOf = (el) => (el.matches('hc-frame') ? el.querySelector(':scope > .hc-screen') : el)
    const resolve = (ref) => {
      const [nodeId, dataId] = ref.trim().split('.')
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return null
      if (!dataId) return node
      return node.querySelector(`[data-id="${CSS.escape(dataId)}"]`)
    }
    const describe = (el) => {
      const node = nodeOf(el)
      if (el === node) return node.id || node.tagName.toLowerCase()
      return `${node?.id}.${el.dataset.id || '<' + el.tagName.toLowerCase() + '>'}`
    }

    const edges = []
    const addEdge = (fromEl, toRef, label, dashed, side) => {
      for (const ref of toRef.split(',').map((s) => s.trim()).filter(Boolean)) {
        const toEl = resolve(ref)
        if (!toEl) errors.push(`${describe(fromEl)} -> ${ref}: no such target`)
        else edges.push({ fromEl, toEl, label, dashed, side })
      }
    }
    for (const el of world.querySelectorAll('[data-to], hc-frame[to], hc-note[to]')) {
      const d = el.dataset
      addEdge(el, d.to || el.getAttribute('to'), d.label || el.getAttribute('label'), 'dashed' in d || el.hasAttribute('dashed'), d.side || el.getAttribute('side'))
    }
    for (const flow of world.querySelectorAll('hc-flow')) {
      const fromRef = flow.getAttribute('from') || ''
      const fromEl = resolve(fromRef)
      if (!fromEl) errors.push(`hc-flow from="${fromRef}": no such source`)
      else addEdge(fromEl, flow.getAttribute('to') || '', flow.getAttribute('label'), flow.hasAttribute('dashed'), flow.getAttribute('side'))
    }
    const seen = new Set()
    for (const n of nodes.filter((n) => n.matches('hc-frame'))) {
      if (!n.id) errors.push('hc-frame without an id')
      else if (seen.has(n.id)) errors.push(`duplicate frame id "${n.id}"`)
      seen.add(n.id)
    }
    if (errors.length) {
      const box = document.createElement('div')
      box.className = 'hc-errors'
      box.textContent = errors.join('\n')
      document.body.append(box)
    }

    const rectOf = (el) => {
      const r = el.getBoundingClientRect()
      const w = world.getBoundingClientRect()
      return { x: (r.left - w.left) / view.k, y: (r.top - w.top) / view.k, w: r.width / view.k, h: r.height / view.k }
    }

    // Pick the side to leave from by which gap between the two containers is
    // widest (or the author's side= hint), then run a cubic bezier straight
    // out of / into those sides.
    function route(S, SC, T, TC, toContainer, side) {
      let gaps = { right: TC.x - (SC.x + SC.w), left: SC.x - (TC.x + TC.w), down: TC.y - (SC.y + SC.h), up: SC.y - (TC.y + TC.h) }
      if (Math.max(...Object.values(gaps)) < 0) {
        // Same container: fall back to the elements themselves.
        gaps = { right: T.x - (S.x + S.w), left: S.x - (T.x + T.w), down: T.y - (S.y + S.h), up: S.y - (T.y + T.h) }
      }
      const dir = side in gaps ? side : Object.keys(gaps).reduce((a, b) => (gaps[b] > gaps[a] ? b : a))
      const scx = S.x + S.w / 2, scy = S.y + S.h / 2, tcx = T.x + T.w / 2, tcy = T.y + T.h / 2
      const inset = 28
      let p1, p2, v
      if (dir === 'right' || dir === 'left') {
        const s = dir === 'right' ? 1 : -1
        p1 = [dir === 'right' ? S.x + S.w : S.x, scy]
        p2 = [dir === 'right' ? T.x : T.x + T.w, toContainer ? clamp(scy, T.y + inset, T.y + T.h - inset) : tcy]
        v = [s, 0]
      } else {
        const s = dir === 'down' ? 1 : -1
        p1 = [scx, dir === 'down' ? S.y + S.h : S.y]
        p2 = [toContainer ? clamp(scx, T.x + inset, T.x + T.w - inset) : tcx, dir === 'down' ? T.y : T.y + T.h]
        v = [0, s]
      }
      const d = Math.max(50, 0.45 * Math.abs(v[0] ? p2[0] - p1[0] : p2[1] - p1[1]))
      const c1 = [p1[0] + v[0] * d, p1[1] + v[1] * d]
      const c2 = [p2[0] - v[0] * d, p2[1] - v[1] * d]
      const mid = [(p1[0] + 3 * c1[0] + 3 * c2[0] + p2[0]) / 8, (p1[1] + 3 * c1[1] + 3 * c2[1] + p2[1]) / 8]
      return { d: `M${p1} C${c1} ${c2} ${p2}`, mid, p1 }
    }

    let lastSig = ''
    function drawEdges() {
      const geo = edges.map((e) => {
        const S = rectOf(boxOf(e.fromEl)), T = rectOf(boxOf(e.toEl))
        const SC = rectOf(boxOf(nodeOf(e.fromEl))), TC = rectOf(boxOf(nodeOf(e.toEl)))
        return route(S, SC, T, TC, e.toEl === nodeOf(e.toEl), e.side)
      })
      const sig = geo.map((g) => g.d).join('|')
      if (sig === lastSig) return
      lastSig = sig
      svg.replaceChildren(defs)
      geo.forEach((g, i) => {
        const e = edges[i]
        const path = svgEl('path', { d: g.d, class: 'hc-edge' + (e.dashed ? ' hc-dashed' : ''), 'marker-end': 'url(#hc-arrow)' })
        path.addEventListener('click', () => focusOn(nodeOf(e.toEl)))
        svg.append(path, svgEl('circle', { cx: g.p1[0], cy: g.p1[1], r: 3.5, fill: ACCENT }))
        if (e.label) {
          const t = svgEl('text', { x: g.mid[0], y: g.mid[1] })
          t.textContent = e.label
          svg.append(t)
        }
      })
    }

    // --- View ------------------------------------------------------------
    function applyView(save = true) {
      world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`
      zoomText.textContent = Math.round(view.k * 100) + '%'
      if (save) try { sessionStorage.setItem(viewKey, JSON.stringify(view)) } catch {}
    }
    function fitRect(r, pad = 60, maxK = 1) {
      const vw = canvas.clientWidth, vh = canvas.clientHeight
      view.k = Math.min(maxK, (vw - pad * 2) / r.w, (vh - pad * 2) / r.h)
      view.x = (vw - r.w * view.k) / 2 - r.x * view.k
      view.y = (vh - r.h * view.k) / 2 - r.y * view.k
      applyView()
    }
    const fitAll = () => fitRect({ x: 0, y: 0, w: world.offsetWidth, h: world.offsetHeight }, 20)
    function focusOn(node) {
      const r = rectOf(boxOf(node))
      world.style.transition = 'transform .25s'
      fitRect({ x: r.x - 200, y: r.y - 60, w: r.w + 400, h: r.h + 120 }, 20, Math.max(view.k, 0.6))
      setTimeout(() => (world.style.transition = ''), 300)
    }
    function zoomAt(cx, cy, factor) {
      const k = clamp(view.k * factor, 0.05, 4)
      view.x = cx - ((cx - view.x) * k) / view.k
      view.y = cy - ((cy - view.y) * k) / view.k
      view.k = k
      applyView()
    }

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01))
      else { view.x -= e.deltaX; view.y -= e.deltaY; applyView() }
    }, { passive: false })

    // One pointer handler: drag a label/note to move that node, drag anything
    // else to pan, and a click without movement on a [data-to] follows it.
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.hc-hud')) return
      const handle = e.target.closest('.hc-label, hc-note')
      const node = handle && nodeOf(handle)
      const x0 = e.clientX, y0 = e.clientY
      const [ox, oy] = node ? pair(node.getAttribute('offset')) : [view.x, view.y]
      let moved = false
      canvas.setPointerCapture(e.pointerId)
      const move = (ev) => {
        const dx = ev.clientX - x0, dy = ev.clientY - y0
        if (!moved && Math.hypot(dx, dy) < 4) return
        moved = true
        if (node) {
          node.setAttribute('offset', `${Math.round(ox + dx / view.k)},${Math.round(oy + dy / view.k)}`)
          applyOffset(node)
          drawEdges()
        } else {
          canvas.classList.add('hc-panning')
          view.x = ox + dx; view.y = oy + dy
          applyView()
        }
      }
      const up = () => {
        canvas.removeEventListener('pointermove', move)
        canvas.removeEventListener('pointerup', up)
        canvas.classList.remove('hc-panning')
        if (moved && node) saveOffset(node)
        if (!moved) {
          const src = e.target.closest?.('[data-to]')
          const target = src && resolve(src.dataset.to.split(',')[0])
          if (target) focusOn(nodeOf(target))
        }
      }
      canvas.addEventListener('pointermove', move)
      canvas.addEventListener('pointerup', up)
    })

    function saveOffset(node) {
      if (!live || !node.id) return
      fetch('/__hc/offset', {
        method: 'POST',
        body: JSON.stringify({ path: decodeURIComponent(location.pathname), id: node.id, offset: node.getAttribute('offset') }),
      }).catch(() => {})
    }

    fitBtn.addEventListener('click', fitAll)
    addEventListener('keydown', (e) => {
      if (e.key === 'f' || e.key === '0') fitAll()
      if (e.key === '1') zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / view.k)
    })
    addEventListener('resize', drawEdges)

    // Initial view: #frame=<id> zooms to one frame, else the saved view, else fit.
    const hash = new URLSearchParams(location.hash.slice(1))
    const hashFrame = hash.get('frame')
    if (hash.get('hud') === '0') hud.style.display = 'none'
    const target = hashFrame && nodes.find((n) => n.id === hashFrame)
    let saved = null
    try { saved = JSON.parse(sessionStorage.getItem(viewKey)) } catch {}
    const initView = () => {
      if (target) {
        const r = rectOf(boxOf(target))
        fitRect({ x: r.x - 40, y: r.y - 60, w: r.w + 80, h: r.h + 100 }, 10, 2)
      } else if (saved) { Object.assign(view, saved); applyView(false) }
      else fitAll()
    }
    initView()
    drawEdges()
    // Late CSS (fonts, Tailwind's browser build) shifts geometry after load;
    // drawEdges is a no-op unless the routed paths actually changed.
    setInterval(drawEdges, 300)
    addEventListener('load', () => { if (!saved || target) initView(); drawEdges() })

    if (live) {
      const es = new EventSource('/__hc/events')
      es.addEventListener('reload', () => location.reload())
      es.onerror = () => (mode.textContent = 'static (server gone)')
    }
    window.htmlCanvas = { edges, errors, fitAll, focusOn, view }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()

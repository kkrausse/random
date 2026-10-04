#!/usr/bin/env bun
// CLI for html-canvas files. Run with: bun hc.ts <command> <file.html>
//
//   init <file>     scaffold the file if missing; (re)copy the runtime next to it
//   check <file>    print the frame/flow outline and report dangling refs
//   serve <file>    live-reload server; dragging a frame writes offset= back
//   shot <file>     PNG via headless Chrome (whole canvas, or --frame <id>)
//   bundle <file>   single self-contained .html with the runtime inlined
import { watch } from 'node:fs'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const RUNTIME = 'html-canvas.js'
const RUNTIME_SRC = resolve(import.meta.dir, '..', RUNTIME)

const SCAFFOLD = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<script src="${RUNTIME}"></script>

<hc-canvas title="Untitled flow" device="phone">
  <hc-row title="Main">
    <hc-frame id="home" title="Home">
      <div class="wf-pad wf-grow">
        <div class="wf-title">Home</div>
        <div class="wf-grow"></div>
        <button class="wf-btn wf-primary" data-to="detail">Open detail</button>
      </div>
    </hc-frame>
    <hc-frame id="detail" title="Detail">
      <div class="wf-bar"><span data-to="home">&lt; Back</span></div>
    </hc-frame>
  </hc-row>
</hc-canvas>
`

interface Frame { id: string; title: string; tag: string; row: string; ids: string[] }
interface Flow { from: string; to: string; label: string }

async function parse(file: string) {
  const frames: Frame[] = []
  const flows: Flow[] = []
  const errors: string[] = []
  let row = ''
  let cur: Frame | null = null
  let notes = 0
  const addFlows = (from: string, to: string, label: string | null) => {
    for (const t of to.split(',').map((s) => s.trim()).filter(Boolean)) flows.push({ from, to: t, label: label ?? '' })
  }
  const rewriter = new HTMLRewriter()
    .on('hc-row', {
      element(el) {
        row = el.getAttribute('title') ?? ''
        el.onEndTag(() => { row = '' })
      },
    })
    .on('hc-frame, hc-note', {
      element(el) {
        const tag = el.tagName
        const id = el.getAttribute('id') ?? (tag === 'hc-note' ? `note#${++notes}` : '')
        if (!id) errors.push('hc-frame without an id')
        if (frames.some((f) => f.id === id)) errors.push(`duplicate id "${id}"`)
        const frame: Frame = { id, title: el.getAttribute('title') ?? '', tag, row, ids: [] }
        frames.push(frame)
        cur = frame
        el.onEndTag(() => { cur = null })
        const to = el.getAttribute('to')
        if (to) addFlows(id, to, el.getAttribute('label'))
      },
    })
    .on('[data-id]', {
      element(el) {
        const id = el.getAttribute('data-id')!
        if (!cur) return void errors.push(`data-id="${id}" outside any hc-frame`)
        if (cur.ids.includes(id)) errors.push(`duplicate data-id "${cur.id}.${id}"`)
        cur.ids.push(id)
      },
    })
    .on('[data-to]', {
      element(el) {
        if (!cur) return void errors.push(`data-to="${el.getAttribute('data-to')}" outside any hc-frame`)
        const id = el.getAttribute('data-id')
        addFlows(`${cur.id}.${id ?? `<${el.tagName}>`}`, el.getAttribute('data-to')!, el.getAttribute('data-label'))
      },
    })
    .on('hc-flow', {
      element(el) {
        const from = el.getAttribute('from') ?? ''
        const to = el.getAttribute('to') ?? ''
        if (!from || !to) errors.push('hc-flow needs both from= and to=')
        else addFlows(from, to, el.getAttribute('label'))
      },
    })
  const html = await readFile(file, 'utf8')
  await rewriter.transform(new Response(html)).text()

  const known = new Set(frames.flatMap((f) => [f.id, ...f.ids.map((i) => `${f.id}.${i}`)]))
  for (const f of flows) {
    if (!f.from.includes('<') && !known.has(f.from)) errors.push(`flow source "${f.from}" does not exist`)
    if (!known.has(f.to)) errors.push(`flow target "${f.to}" does not exist (from ${f.from})`)
  }
  if (!html.includes(RUNTIME)) errors.push(`file never loads ${RUNTIME}`)
  return { frames, flows, errors, html }
}

async function check(file: string) {
  const { frames, flows, errors } = await parse(file)
  let row: string | null = null
  for (const f of frames) {
    if (f.row !== row) console.log(`row ${JSON.stringify((row = f.row))}`)
    const ids = f.ids.length ? `  [${f.ids.join(' ')}]` : ''
    console.log(`  ${f.tag === 'hc-note' ? 'note ' : ''}${f.id}${f.title ? ` ${JSON.stringify(f.title)}` : ''}${ids}`)
  }
  console.log('flows')
  for (const f of flows) console.log(`  ${f.from} -> ${f.to}${f.label ? `  ${JSON.stringify(f.label)}` : ''}`)
  const targets = new Set(flows.map((f) => f.to.split('.')[0]))
  const sources = new Set(flows.map((f) => f.from.split('.')[0]))
  const orphans = frames.filter((f) => f.tag === 'hc-frame' && !targets.has(f.id) && !sources.has(f.id))
  if (orphans.length) console.log(`unconnected: ${orphans.map((f) => f.id).join(' ')}`)
  for (const e of errors) console.error(`error: ${e}`)
  console.log(`${frames.length} nodes, ${flows.length} flows, ${errors.length} errors`)
  if (errors.length) process.exit(1)
}

async function init(file: string) {
  if (await Bun.file(file).exists()) console.log(`kept existing ${file}`)
  else {
    await writeFile(file, SCAFFOLD)
    console.log(`created ${file}`)
  }
  await copyFile(RUNTIME_SRC, join(dirname(file), RUNTIME))
  console.log(`copied ${RUNTIME} -> ${dirname(file)}/`)
}

// Rewrites offset="..." on the opening tag of the frame/note with this id,
// leaving the rest of the hand-authored source untouched.
function setOffset(html: string, id: string, offset: string) {
  const tag = new RegExp(`<hc-(?:frame|note)\\b[^>]*\\bid="${id.replace(/[^\w-]/g, '\\$&')}"[^>]*>`)
  return html.replace(tag, (open) => {
    const bare = open.replace(/\s+offset="[^"]*"/, '')
    return offset === '0,0' ? bare : bare.replace(/>$/, ` offset="${offset}">`)
  })
}

async function serve(file: string, port: number) {
  const root = dirname(file)
  const clients = new Set<ReadableStreamDefaultController>()
  let quietUntil = 0
  const server = Bun.serve({
    port,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/__hc/events') {
        let ctl: ReadableStreamDefaultController
        return new Response(
          new ReadableStream({
            start(c) { ctl = c; clients.add(c); c.enqueue(': ok\n\n') },
            cancel() { clients.delete(ctl) },
          }),
          { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } },
        )
      }
      const path = resolve(root, '.' + decodeURIComponent(url.pathname))
      if (relative(root, path).startsWith('..')) return new Response('forbidden', { status: 403 })
      if (url.pathname === '/__hc/offset' && req.method === 'POST') {
        const body = (await req.json()) as { path: string; id: string; offset: string }
        const target = resolve(root, '.' + body.path)
        if (relative(root, target).startsWith('..') || !/^-?\d+,-?\d+$/.test(body.offset)) return new Response('bad request', { status: 400 })
        quietUntil = Date.now() + 500
        await writeFile(target, setOffset(await readFile(target, 'utf8'), body.id, body.offset))
        return new Response('ok')
      }
      if (url.pathname === '/') return Response.redirect('/' + basename(file))
      const f = Bun.file(path)
      return (await f.exists()) ? new Response(f, { headers: { 'cache-control': 'no-store' } }) : new Response('not found', { status: 404 })
    },
  })
  let timer: Timer | undefined
  watch(root, { recursive: true }, () => {
    if (Date.now() < quietUntil) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      for (const c of clients) c.enqueue('event: reload\ndata: 1\n\n')
    }, 80)
  })
  console.log(`http://localhost:${server.port}/${basename(file)}`)
}

function findChrome() {
  const candidates = [
    process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ...['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'brave-browser'].map((n) => Bun.which(n)),
  ]
  const found = candidates.find((c) => c && Bun.file(c).size > 0)
  if (!found) throw new Error('no Chromium-family browser found; set CHROME=/path/to/binary')
  return found
}

async function shot(file: string, out: string, frame: string | undefined, size: string) {
  const url = pathToFileURL(file).href + (frame ? `#frame=${frame}` : '')
  const proc = Bun.spawn(
    [findChrome(), '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      `--window-size=${size.replace('x', ',')}`, '--virtual-time-budget=5000', `--screenshot=${out}`, url],
    { stdout: 'ignore', stderr: 'ignore' },
  )
  if ((await proc.exited) !== 0) throw new Error('chrome exited non-zero')
  console.log(out)
}

async function bundle(file: string, out: string) {
  const { html } = await parse(file)
  const runtime = await readFile(RUNTIME_SRC, 'utf8')
  const tag = new RegExp(`<script src="[^"]*${RUNTIME.replace('.', '\\.')}"></script>`)
  if (!tag.test(html)) throw new Error(`no <script src="${RUNTIME}"> tag to inline`)
  await writeFile(out, html.replace(tag, () => `<script>${runtime.replaceAll('</script', '<\\/script')}</script>`))
  console.log(out)
}

const [cmd, fileArg, ...rest] = process.argv.slice(2)
const flag = (name: string) => {
  const i = rest.indexOf(name)
  return i >= 0 ? rest[i + 1] : undefined
}
if (!cmd || !fileArg) {
  console.error('usage: bun hc.ts <init|check|serve|shot|bundle> <file.html> [-o out] [--frame id] [--size WxH] [--port n]')
  process.exit(2)
}
const file = resolve(fileArg)
const stem = file.replace(/\.html$/, '')
switch (cmd) {
  case 'init': await init(file); break
  case 'check': await check(file); break
  case 'serve': await serve(file, Number(flag('--port') ?? 4747)); break
  case 'shot': await shot(file, resolve(flag('-o') ?? `${stem}${flag('--frame') ? '.' + flag('--frame') : ''}.png`), flag('--frame'), flag('--size') ?? (flag('--frame') ? '900x1100' : '2400x1500')); break
  case 'bundle': await bundle(file, resolve(flag('-o') ?? `${stem}.bundle.html`)); break
  default: console.error(`unknown command ${cmd}`); process.exit(2)
}

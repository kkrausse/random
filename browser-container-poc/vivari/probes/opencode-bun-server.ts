import { Workspace, Runtime, opfsStore } from '../../workspace-api/src/index'

const log = (text: string) => { document.querySelector('pre')!.textContent += text + '\n' }
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function bounded<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(label + ' timed out')), ms) })]) }
  finally { clearTimeout(timer) }
}

async function qualify(runID: string) {
  let stage = 'manifest', runtime: Awaited<ReturnType<typeof Runtime.start>> | undefined
  let workspace: Awaited<ReturnType<typeof Workspace.open>> | undefined
  let output: Promise<unknown> | undefined
  const checks: string[] = []
  const pass = (name: string) => { checks.push(name); log('PASS ' + name) }
  try {
    const manifest = await fetch('/runtime/distribution.json').then(r => { if (!r.ok) throw Error(); return r.json() })
    const receipt = await fetch('/package-manifest').then(r => { if (!r.ok) throw Error(); return r.json() })
    const distribution = { name: 'vivari', version: manifest.version, assetBaseUrl: '/runtime/' }
    stage = 'OPFS open'
    workspace = await Workspace.open({ id: 'default', storage: opfsStore(distribution) })
    stage = 'fresh origin (use a new localhost port)'
    // v0 has one workspace per origin. Reject any prior workspace content.
    if ((await workspace.fs.readdir('/')).length) throw Error()
    await workspace.fs.writeFile('/opencode-bun-run.json', JSON.stringify({ runID, runtime: manifest.version }))
    await workspace.flush()
    pass('fresh OPFS workspace default')
    stage = 'writable guest directories'
    for (const path of ['home', 'config', 'state', 'data', 'cache', 'tmp']) await workspace.fs.mkdir('/.server/' + path)
    stage = 'verified app delivery'
    runtime = await Runtime.start({ distribution, workspace, tools: { delivery: {
      name: 'opencode-bun-server-delivery', version: '1', async bind(context) {
        for (const asset of receipt.assets) {
          if (typeof asset.file !== 'string' || !/^[^/\\]+$/.test(asset.file) || asset.file === '.' || asset.file === '..') throw Error()
          const response = await fetch('/package/' + encodeURIComponent(asset.file))
          if (!response.ok) throw Error()
          const bytes = new Uint8Array(await response.arrayBuffer())
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('')
          if (hash !== asset.sha256 || bytes.length !== asset.bytes) throw Error()
          await context.installFile('/app/' + asset.file, bytes)
        }
        return async () => receipt.assets.length
      },
    } } })
    pass('all app output mounted unchanged; length and SHA-256 verified')
    const env = {
      PATH: '/bin', HOME: '/workspace/.server/home', OPENCODE_TEST_HOME: '/workspace/.server/home',
      XDG_CONFIG_HOME: '/workspace/.server/config', XDG_STATE_HOME: '/workspace/.server/state',
      XDG_DATA_HOME: '/workspace/.server/data', XDG_CACHE_HOME: '/workspace/.server/cache',
      TMPDIR: '/workspace/.server/tmp', OPENCODE_DB: '/workspace/.server/data/opencode.sqlite',
      OPENCODE_DISABLE_FFF: '1', OPENCODE_DISABLE_FILEWATCHER: '1', OPENCODE_DISABLE_MODELS_FETCH: '1',
      OPENCODE_TREE_SITTER_WASM_PATH: '/app/tree-sitter.wasm',
      OPENCODE_TREE_SITTER_BASH_WASM_PATH: '/app/tree-sitter-bash.wasm',
      OPENCODE_TREE_SITTER_POWERSHELL_WASM_PATH: '/app/tree-sitter-powershell.wasm',
    }
    stage = 'Bun shim launch'
    const execution = await runtime.node({ entry: '/bin/bun.js', args: ['/app/server.js', '--service'], cwd: '/app', env })
    // Never retain raw output: service logs may contain generated credentials.
    const drain = async (stream: AsyncIterable<Uint8Array>) => { let count = 0; for await (const bytes of stream) count += bytes.length; return count }
    output = Promise.all([drain(execution.stdout), drain(execution.stderr)])
    void output.catch(() => {})
    void execution.exited.catch(() => {})
    execution.closeStdin()
    stage = 'listener 4096'
    const endpoint = await runtime.expose(4096, { signal: AbortSignal.timeout(60_000) })
    stage = 'guest service registration'
    let registration: { id: string; password: string; url: string } | undefined
    const until = Date.now() + 30_000
    while (Date.now() < until) {
      let bytes: Uint8Array | undefined
      try { bytes = await workspace.fs.readFile('/.server/state/opencode/service-local.json') } catch { /* written after listen */ }
      if (bytes) {
        const info = JSON.parse(new TextDecoder().decode(bytes))
        if (typeof info.id !== 'string' || !info.id || typeof info.password !== 'string' || !info.password || info.url !== 'http://127.0.0.1:4096') throw Error()
        registration = info
        break
      }
      await delay(100)
    }
    if (!registration) throw Error()
    pass('guest-generated registration validated (credentials omitted)')
    const headers = { authorization: 'Basic ' + btoa('opencode:' + registration.password), 'content-type': 'application/json' }
    stage = 'authenticated health'
    const health = await endpoint.fetch('/api/health', { headers, signal: AbortSignal.timeout(20_000) })
    if (health.status !== 200 || (await health.json()).healthy !== true) throw Error()
    pass('authenticated health healthy=true')
    stage = 'managed service stop'
    const stopped = await endpoint.fetch('/api/service/stop', { method: 'POST', headers, body: JSON.stringify({ instanceID: registration.id }), signal: AbortSignal.timeout(20_000) })
    if (stopped.status !== 200 || (await stopped.json()).accepted !== true) throw Error()
    pass('managed stop accepted=true')
    stage = 'natural exit'
    const exit = await bounded(execution.exited, 20_000, 'Natural exit')
    const outputBytes = await bounded(output, 5_000, 'Output drains')
    if (exit.exitCode !== 0 || exit.forced || exit.signal !== null) throw Error()
    pass('natural exitCode=0 forced=false signal=null before cleanup')
    return { status: 'PASS', runtime: manifest.version, checks, exit, outputBytes, assets: receipt.assets.length }
  } catch {
    // Error objects and response bodies can contain credentials; report only the checkpoint.
    throw Error('Failed at ' + stage)
  } finally {
    try { await runtime?.stop() }
    finally {
      try { await workspace?.flush() }
      finally { await workspace?.close() }
    }
    if (output) await bounded(output, 5_000, 'Cleanup drains')
  }
}

async function run() {
  const { runID } = await fetch('/run-config').then(r => r.json())
  if (new URL(location.href).searchParams.get('runID') !== runID) throw Error('Run ID mismatch; use the printed URL')
  let result
  try { result = await qualify(runID) }
  catch (error) {
    const message = error instanceof Error && error.message.startsWith('Failed at ') ? error.message : 'Probe cleanup or startup failed'
    result = { status: 'FAIL', error: message }
  }
  Object.assign(window, { opencodeBunServerResult: result })
  log('RESULT ' + JSON.stringify(result))
  const response = await fetch('/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runID, result }) })
  if (!response.ok) throw Error('Result reporting failed: HTTP ' + response.status)
}
if (new URL(location.href).searchParams.has('autorun')) await run()

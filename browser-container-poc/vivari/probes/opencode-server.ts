import { Workspace, Runtime, opfsStore, type Execution, type Endpoint } from '../../workspace-api/src/index'

const log = (text: string) => { document.querySelector('pre')!.textContent += text + '\n' }
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function bounded<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(label + ' timed out')), ms) })]) }
  finally { clearTimeout(timer!) }
}
const assert = (condition: unknown, label: string) => { if (!condition) throw Error(label); log('PASS ' + label) }

export async function start() {
  const manifest = await fetch('/runtime/distribution.json').then(r => r.json())
  const distribution = { name: 'vivari', version: manifest.version, assetBaseUrl: '/runtime/' }
  const workspace = await Workspace.open({ id: 'default', storage: opfsStore(distribution) })
  // v0 supports one store per origin. Qualification requires a new localhost port.
  const used = await workspace.fs.stat('/baseline-run.json').then(() => true, () => false)
  if (used) { await workspace.close(); throw Error('Use a fresh origin (PORT) for qualification') }
  await workspace.fs.writeFile('/baseline-run.json', JSON.stringify({ started: Date.now(), runtime: manifest.version }))
  log('Fresh workspace default; runtime ' + manifest.version)
  const receipt = await fetch('/package/receipt.json').then(r => r.json())
  const runtime = await Runtime.start({ distribution, workspace, tools: { delivery: {
    name: 'server-delivery', version: '1', async bind(context) {
      for (const asset of receipt.assets) {
        const response = await fetch('/package/' + asset.file)
        if (!response.ok) throw Error('Asset HTTP ' + response.status + ': ' + asset.file)
        const bytes = new Uint8Array(await response.arrayBuffer())
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('')
        if (hash !== asset.sha256 || bytes.length !== asset.bytes) throw Error('Asset integrity: ' + asset.file)
        await context.installFile(asset.destination, bytes)
      }
      return () => receipt.assets.length
    },
  } } })
  log('Delivered ' + runtime.tools.delivery() + ' verified assets')
  const model = 'muse-spark-1.3-contributor-free'
  await workspace.fs.writeFile('/.server/config/opencode/opencode.json', JSON.stringify({
    model: 'opencode/' + model, snapshots: false,
    providers: { opencode: { settings: { baseURL: `http://host.vivari.internal:${location.port}/api/model/opencode` } } },
    permissions: [{ action: 'read', resource: '*', effect: 'allow' }, { action: 'edit', resource: '*', effect: 'allow' }],
  }))
  const env = {
    XDG_DATA_HOME: '/workspace/.server/data', XDG_CONFIG_HOME: '/workspace/.server/config',
    XDG_CACHE_HOME: '/workspace/.server/cache', XDG_STATE_HOME: '/workspace/.server/state',
    OPENCODE_MODELS_PATH: '/opencode-server/models.json', OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_DISABLE_FFF: '1', OPENCODE_DISABLE_FILEWATCHER: '1', PORT: '4106',
  }
  let execution: Execution, endpoint: Endpoint, registration: { id: string; password: string }
  let output: Promise<void[]>
  async function launch() {
    execution = await runtime.node({ entry: receipt.entry, env })
    const drain = async (stream: AsyncIterable<Uint8Array>) => { for await (const bytes of stream) log(decode(bytes)) }
    output = Promise.all([drain(execution.stdout), drain(execution.stderr)])
    void execution.exited.then(result => log('EXIT ' + JSON.stringify(result)))
    endpoint = await runtime.expose(4106, { signal: AbortSignal.timeout(60_000) })
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      try {
        registration = JSON.parse(decode(await workspace.fs.readFile('/.server/state/opencode/service-local.json')))
        const health = await request('/api/health')
        if (health.status === 200) { await health.json(); log('PASS server ready'); return }
        await health.text()
      } catch { /* registration is written after listener creation */ }
      await delay(100)
    }
    throw Error('Server readiness timed out')
  }
  function request(path: string, options: RequestInit = {}) {
    return endpoint.fetch(path, { ...options, signal: options.signal ?? AbortSignal.timeout(20_000), headers: { authorization: 'Basic ' + btoa('opencode:' + registration.password), 'content-type': 'application/json', ...options.headers } })
  }
  async function json(path: string, body?: unknown) {
    const response = await request(path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })
    if (!response.ok) throw Error(`HTTP ${response.status} ${path}: ${await response.text()}`)
    return response.json()
  }
  async function stop() {
    const stopped = await json('/api/service/stop', { instanceID: registration.id })
    assert(stopped.accepted, 'graceful stop accepted')
    const exit = await bounded(execution.exited, 15_000, 'Server exit')
    await output
    assert(exit.exitCode === 0 && !exit.forced, 'server exits zero without forced termination')
  }
  async function qualify() {
    const subscription = new AbortController()
    try {
      const created = await json('/api/session', { title: 'Server-only acceptance', location: { directory: '/workspace' }, model: { providerID: 'opencode', id: model } })
      const sessionID = created.data.id
      assert(typeof sessionID === 'string', 'session created')
      await workspace.fs.writeFile('/baseline.txt', 'BASELINE_BEFORE\n')
      const response = await request('/api/event', { signal: subscription.signal })
      assert(response.ok && response.headers.get('content-type')?.includes('text/event-stream'), 'real event SSE connected')
      const calls = new Map<string, string>(), success = new Set<string>()
      let deltas = 0, completed = false, finalText = '', failure = ''
      const reader = response.body!.getReader(), decoder = new TextDecoder()
      const drain = (async () => {
        let pending = ''
        try {
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            pending += decoder.decode(value, { stream: true })
            let end: number
            while ((end = pending.indexOf('\n')) !== -1) {
              const line = pending.slice(0, end); pending = pending.slice(end + 1)
              if (!line.startsWith('data: ')) continue
              const event = JSON.parse(line.slice(6)), data = event.data
              if (data?.sessionID !== sessionID) continue
              if (event.type === 'session.tool.input.started') calls.set(data.id, data.name)
              if (event.type === 'session.tool.success') { success.add(calls.get(data.id)!); log('TOOL success ' + calls.get(data.id)) }
              if (event.type === 'session.tool.failed' || event.type === 'session.execution.failed') failure = JSON.stringify(data.error ?? data)
              if (event.type === 'session.text.delta') deltas++
              if (event.type === 'session.text.ended') finalText += data.text
              if (event.type === 'session.execution.succeeded') completed = true
            }
          }
        } catch (error) { if (!subscription.signal.aborted) failure = String(error) }
      })()
      await json('/api/session/' + sessionID + '/prompt', { text: 'Use read to read /workspace/baseline.txt, edit to replace BASELINE_BEFORE with BASELINE_AFTER, grep to find BASELINE_AFTER in baseline.txt, and glob to locate baseline.txt under /workspace. Actually invoke all four tools; use tool discovery if needed. Do not use shell. Finish by replying BASELINE_TOOLS_OK.' })
      const deadline = Date.now() + 180_000
      while (!completed && !failure && Date.now() < deadline) await delay(100)
      if (failure) throw Error(failure)
      assert(completed, 'model execution completes')
      assert(deltas > 0 && finalText.includes('BASELINE_TOOLS_OK'), 'model text streamed to client')
      for (const tool of ['read', 'edit', 'grep', 'glob']) assert(success.has(tool), tool + ' completed successfully')
      assert(decode(await workspace.fs.readFile('/baseline.txt')) === 'BASELINE_AFTER\n', 'model edit visible through workspace filesystem')
      subscription.abort(); await drain
      const oldEndpoint = endpoint, oldInstance = registration.id
      await stop()
      await launch()
      assert(registration.id !== oldInstance && endpoint.url !== oldEndpoint.url, 'restart replaces server and listener identities')
      await oldEndpoint.fetch('/api/health').then(() => { throw Error('Old endpoint retargeted') }, () => log('PASS old endpoint rejects'))
      assert((await json('/api/session/' + sessionID)).data.id === sessionID, 'session survives restart')
      assert(decode(await workspace.fs.readFile('/baseline.txt')) === 'BASELINE_AFTER\n', 'edit survives restart')
      await stop()
      await runtime.stop(); await workspace.flush(); await workspace.close()
      const result = { status: 'PASS', revision: receipt.revision, runtime: manifest.version, model, sessionID, deltas, tools: [...success].sort(), assets: receipt.assets.length, transforms: receipt.transforms }
      log('RESULT ' + JSON.stringify(result))
      return result
    } catch (error) {
      log('RESULT FAIL ' + String(error))
      throw error
    } finally { subscription.abort(); await runtime.stop(); await workspace.close() }
  }
  const baseline = { workspace, runtime, qualify, close: async () => { await runtime.stop(); await workspace.close() } }
  Object.assign(window, { serverBaseline: baseline })
  await launch()
  return 'server ready; call serverBaseline.qualify()'
}
Object.assign(window, { startServerBaseline: start })

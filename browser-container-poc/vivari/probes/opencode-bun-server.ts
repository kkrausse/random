import { Workspace, Runtime, opfsStore } from '../../workspace-api/src/index'

const log = (text: string) => { document.querySelector('pre')!.textContent += text + '\n' }
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function bounded<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(label + ' timed out')), ms) })]) }
  finally { clearTimeout(timer) }
}

async function qualify(runID: string, restart: boolean, sessionRetention: boolean) {
  let stage = 'manifest', runtime: Awaited<ReturnType<typeof Runtime.start>> | undefined
  let workspace: Awaited<ReturnType<typeof Workspace.open>> | undefined
  let output: Promise<unknown> | undefined
  let phase = 'initial', previousRegistrationID: string | undefined
  const phases: { phase: string; checks: string[]; exit: { exitCode: number; forced: boolean; signal: string | null }; outputBytes: unknown; cleanup: string }[] = []
  const database: { checkpoint: string; path: string; bytes: number; sha256: string; sqliteHeader: true }[] = []
  const sessionTitle = 'Browser OPFS retention probe'
  let session: { id: string; title: string; created: true; idTitleChecked: boolean; modelRequests: 0; toolRequests: 0 } | undefined
  const scope = restart ? 'same-page full workspace/runtime reopen; no page reload' : 'single fresh-origin lifecycle'
  const checks: string[] = []
  const pass = (name: string) => { checks.push(name); log('PASS ' + name) }
  const snapshotDatabase = async (checkpoint: string) => {
    const path = '/.server/data/opencode.sqlite'
    const bytes = new Uint8Array(await workspace!.fs.readFile(path))
    if (bytes.length < 100 || new TextDecoder().decode(bytes.subarray(0, 16)) !== 'SQLite format 3\0') throw Error()
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('')
    const snapshot = { checkpoint, path, bytes: bytes.length, sha256, sqliteHeader: true as const }
    database.push(snapshot)
    return snapshot
  }
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
    for (const nextPhase of restart ? ['initial', 'reopened'] : ['initial']) {
      phase = nextPhase
      const checksStart = checks.length
      if (phase === 'reopened') {
        stage = 'same OPFS workspace reopen'
        workspace = await Workspace.open({ id: 'default', storage: opfsStore(distribution) })
        const marker = JSON.parse(new TextDecoder().decode(await workspace.fs.readFile('/opencode-bun-run.json')))
        if (marker.runID !== runID || marker.runtime !== manifest.version) throw Error()
        stage = 'SQLite retention before second runtime start'
        const reopened = await snapshotDatabase('after reopen, before second Runtime.start')
        if (reopened.bytes !== database[0].bytes || reopened.sha256 !== database[0].sha256) throw Error()
        pass('same workspace marker and SQLite size/SHA-256 retained across reopen')
        // A leftover registration must never qualify the new execution.
        stage = 'remove prior registration if retained'
        if ((await workspace.fs.readdir('/.server/state/opencode')).includes('service-local.json')) {
          await workspace.fs.remove('/.server/state/opencode/service-local.json')
        }
      }
      if (!workspace) throw Error()
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
          if (typeof info.id !== 'string' || !info.id || info.id === previousRegistrationID || typeof info.password !== 'string' || !info.password || info.url !== 'http://127.0.0.1:4096') throw Error()
          registration = info
          break
        }
        await delay(100)
      }
      if (!registration) throw Error()
      previousRegistrationID = registration.id
      pass('guest-generated registration validated (credentials omitted)')
      const headers = { authorization: 'Basic ' + btoa('opencode:' + registration.password), 'content-type': 'application/json' }
      stage = 'authenticated health'
      const health = await endpoint.fetch('/api/health', { headers, signal: AbortSignal.timeout(20_000) })
      if (health.status !== 200 || (await health.json()).healthy !== true) throw Error()
      pass('authenticated health healthy=true')
      if (sessionRetention) {
        stage = phase === 'initial' ? 'create one unprompted session' : 'retrieve retained session ID/title'
        if (phase === 'reopened' && !session) throw Error()
        const response = await endpoint.fetch(phase === 'initial' ? '/api/session' : '/api/session/' + encodeURIComponent(session!.id), {
          method: phase === 'initial' ? 'POST' : 'GET', headers,
          ...(phase === 'initial' ? { body: JSON.stringify({ title: sessionTitle, location: { directory: '/app' } }) } : {}),
          signal: AbortSignal.timeout(20_000),
        })
        if (response.status !== 200) throw Error()
        const data = (await response.json()).data
        if (typeof data?.id !== 'string' || !data.id.startsWith('ses_') || data.title !== sessionTitle) throw Error()
        if (phase === 'initial') session = { id: data.id, title: data.title, created: true, idTitleChecked: false, modelRequests: 0, toolRequests: 0 }
        else {
          if (data.id !== session!.id || data.title !== session!.title) throw Error()
          session!.idTitleChecked = true
        }
        pass(phase === 'initial' ? 'one unprompted session created; no model/tool requests' : 'retained session ID/title checked; no model/tool requests')
      }
      stage = 'managed service stop'
      const stopped = await endpoint.fetch('/api/service/stop', { method: 'POST', headers, body: JSON.stringify({ instanceID: registration.id }), signal: AbortSignal.timeout(20_000) })
      if (stopped.status !== 200 || (await stopped.json()).accepted !== true) throw Error()
      pass('managed stop accepted=true')
      stage = 'natural exit'
      const exit = await bounded(execution.exited, 20_000, 'Natural exit')
      const outputBytes = await bounded(output, 5_000, 'Output drains')
      if (exit.exitCode !== 0 || exit.forced || exit.signal !== null) throw Error()
      pass('natural exitCode=0 forced=false signal=null before cleanup')
      const phaseResult = { phase, checks: checks.slice(checksStart), exit, outputBytes, cleanup: 'pending' }
      phases.push(phaseResult)
      stage = 'runtime.stop'
      await runtime.stop()
      runtime = undefined
      stage = 'workspace.flush'
      await workspace.flush()
      if (restart && phase === 'initial') {
        stage = 'SQLite snapshot after first runtime.stop and workspace.flush'
        await snapshotDatabase('after first runtime.stop and workspace.flush, before close')
      }
      stage = 'workspace.close'
      await workspace.close()
      workspace = undefined
      output = undefined
      phaseResult.cleanup = 'runtime.stop + workspace.flush + workspace.close completed'
      log('PASS ' + phase + ' full cleanup completed')
    }
    const last = phases[phases.length - 1]
    return { status: 'PASS', restart, sessionRetention, session, scope, runtime: manifest.version, checks, phases, database, exit: last.exit, outputBytes: last.outputBytes, assets: receipt.assets.length }
  } catch {
    // Error objects and response bodies can contain credentials; report only the checkpoint.
    return { status: 'FAIL', restart, sessionRetention, session, scope, error: 'Failed at ' + phase + ': ' + stage, checks, phases, database }
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
  const { runID, restart, sessionRetention } = await fetch('/run-config').then(r => r.json())
  if (new URL(location.href).searchParams.get('runID') !== runID) throw Error('Run ID mismatch; use the printed URL')
  if (typeof restart !== 'boolean' || new URL(location.href).searchParams.has('restart') !== restart) throw Error('Restart mode mismatch; use the printed URL')
  if (typeof sessionRetention !== 'boolean' || new URL(location.href).searchParams.has('session-retention') !== sessionRetention || (sessionRetention && !restart)) throw Error('Session retention mode mismatch; use the printed URL')
  let result
  try { result = await qualify(runID, restart, sessionRetention) }
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

import { Workspace, Runtime, opfsStore } from '../../workspace-api/src/index'

const log = (text: string) => { document.querySelector('pre')!.textContent += text + '\n' }
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function bounded<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(label + ' timed out')), ms) })]) }
  finally { clearTimeout(timer) }
}

async function qualify(runID: string, restart: boolean, sessionRetention: boolean, model: boolean, read: boolean) {
  let stage = 'manifest', runtime: Awaited<ReturnType<typeof Runtime.start>> | undefined
  let workspace: Awaited<ReturnType<typeof Workspace.open>> | undefined
  let output: Promise<unknown> | undefined
  const modelEvidence = model ? { providerID: 'opencode', id: 'muse-spark-1.3-contributor-free', deltas: 0, toolEvents: 0, promptRequests: 0, textMatched: false, textBlocks: 0, textLength: 0, trimmedTextMatched: false, lastBlockMatched: false, terminal: 'pending', sseCleanup: 'pending', cleanup: 'pending' } : undefined
  const readEvidence = read ? { target: '/workspace/read-probe.txt', calls: 0, successes: 0, targetMatched: false, contentMatched: false, providerExecuted: null as boolean | null, managedStop: 'pending', cleanupExitStatus: 'pending', exit: null as { exitCode: number; forced: boolean; signal: string | null } | null } : undefined
  const readContent = 'VIVARI_READ_PROBE_6ac6618_7f92d03b'
  let managedStop: (() => Promise<void>) | undefined
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
      if (modelEvidence) {
        stage = 'model configuration'
        await workspace.fs.writeFile('/.server/config/opencode/opencode.json', JSON.stringify({
          model: 'opencode/' + modelEvidence.id, snapshots: false,
          providers: { opencode: { settings: { baseURL: `http://host.vivari.internal:${location.port}/api/model/opencode` } } },
          ...(read ? { permissions: [{ action: 'read', resource: '*', effect: 'allow' }] } : {}),
        }))
        if (read) await workspace.fs.writeFile('/read-probe.txt', readContent)
      }
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
        ...(model ? { OPENCODE_MODELS_PATH: '/app/models.json' } : {}),
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
      if (read) managedStop = async () => {
        const stopped = await endpoint.fetch('/api/service/stop', { method: 'POST', headers, body: JSON.stringify({ instanceID: registration.id }), signal: AbortSignal.timeout(20_000) })
        if (stopped.status !== 200 || (await stopped.json()).accepted !== true) throw Error('Managed cleanup stop failed')
        readEvidence!.managedStop = 'accepted'
        try {
          const exit = await bounded(execution.exited, 20_000, 'Managed cleanup exit')
          readEvidence!.exit = { exitCode: exit.exitCode, forced: exit.forced, signal: exit.signal }
          readEvidence!.cleanupExitStatus = exit.exitCode === 0 && !exit.forced && exit.signal === null ? 'natural exit verified' : 'unexpected exit'
        } catch { readEvidence!.cleanupExitStatus = 'exit unavailable within bound' }
      }
      stage = 'authenticated health'
      const health = await endpoint.fetch('/api/health', { headers, signal: AbortSignal.timeout(20_000) })
      if (health.status !== 200 || (await health.json()).healthy !== true) throw Error()
      pass('authenticated health healthy=true')
      if (modelEvidence) {
        stage = 'create minimal model session'
        const created = await endpoint.fetch('/api/session', { method: 'POST', headers,
          body: JSON.stringify({ title: 'Minimal build model SSE', location: { directory: '/workspace' }, model: { providerID: modelEvidence.providerID, id: modelEvidence.id } }),
          signal: AbortSignal.timeout(20_000),
        })
        if (created.status !== 200) throw Error()
        const data = (await created.json()).data
        if (typeof data?.id !== 'string' || !data.id.startsWith('ses_') || data.title !== 'Minimal build model SSE') throw Error()
        const sessionID = data.id
        pass('minimal model session created')
        const subscription = new AbortController()
        let drain: Promise<void> | undefined
        let failed = false, completed = false, finalText = ''
        const calls = new Map<string, { called: boolean; succeeded: boolean }>()
        const deadline = setTimeout(() => { modelEvidence.terminal = 'deadline exceeded'; subscription.abort() }, 60_000)
        try {
          stage = 'model SSE subscription'
          const response = await endpoint.fetch('/api/event', { headers, signal: subscription.signal })
          if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw Error()
          const reader = response.body.getReader(), decoder = new TextDecoder()
          drain = (async () => {
            let pending = ''
            try {
              for (;;) {
                const { value, done } = await reader.read()
                if (done) {
                  if (!completed) { failed = true; modelEvidence.terminal = 'stream closed early'; subscription.abort() }
                  break
                }
                pending += decoder.decode(value, { stream: true })
                let end: number
                while ((end = pending.indexOf('\n')) !== -1) {
                  const line = pending.slice(0, end); pending = pending.slice(end + 1)
                  if (!line.startsWith('data: ')) continue
                  const event = JSON.parse(line.slice(6)), data = event.data
                  if (data?.sessionID !== sessionID) continue
                  if (event.type.startsWith('session.tool.')) modelEvidence.toolEvents++
                  if (readEvidence && event.type.startsWith('session.tool.')) {
                    // Pinned schema/session-event.ts: Started supplies name; Called supplies input.
                    if (event.type === 'session.tool.input.started') {
                      readEvidence.calls++
                      if (data.name !== 'read' || typeof data.id !== 'string' || calls.has(data.id) || readEvidence.calls !== 1) failed = true
                      else calls.set(data.id, { called: false, succeeded: false })
                    } else {
                      const call = calls.get(data.id)
                      if (!call) failed = true
                      else if (event.type === 'session.tool.called') {
                        if (call.called || data.input?.path !== readEvidence.target || data.executed !== false) failed = true
                        else { call.called = true; readEvidence.targetMatched = true }
                      } else if (event.type === 'session.tool.success') {
                        // executed is providerExecuted, not local execution success.
                        if (!call.called || call.succeeded || data.executed !== false || !Array.isArray(data.content) || !data.content.length) failed = true
                        else {
                          call.succeeded = true; readEvidence.successes++; readEvidence.providerExecuted = data.executed
                          // Pinned read.toModelContent emits a header and numbered lines, normalized to Content.Text.
                          readEvidence.contentMatched = data.content.length === 1 && data.content[0]?.type === 'text' &&
                            data.content[0].text === `Read file ${readEvidence.target}, lines 1-1\n1: ${readContent}`
                          if (!readEvidence.contentMatched) failed = true
                        }
                      }
                    }
                    if (failed) modelEvidence.terminal = 'read tool event rejected'
                  }
                  if ((!read && event.type.startsWith('session.tool.')) || event.type === 'session.tool.failed' || event.type === 'session.execution.failed') {
                    failed = true
                    modelEvidence.terminal = event.type === 'session.execution.failed' ? event.type : 'tool event rejected'
                  }
                  if (event.type === 'session.text.delta') modelEvidence.deltas++
                  if (event.type === 'session.text.ended') {
                    if (typeof data.text !== 'string') failed = true
                    else {
                      finalText += data.text
                      // Comparison-only diagnostics: no visible text, reasoning, or provider state retained.
                      const expected = read ? readContent : 'MINIMAL_MODEL_OK'
                      modelEvidence.textBlocks++
                      modelEvidence.textLength = finalText.length
                      modelEvidence.textMatched = finalText === expected
                      modelEvidence.trimmedTextMatched = finalText.trim() === expected
                      modelEvidence.lastBlockMatched = data.text === expected
                    }
                  }
                  if (event.type === 'session.execution.succeeded') { completed = true; modelEvidence.terminal = event.type }
                  if (failed) subscription.abort()
                }
              }
            } catch {
              if (!subscription.signal.aborted) { failed = true; modelEvidence.terminal = 'stream failed'; subscription.abort() }
            }
            finally { reader.releaseLock() }
          })()
          stage = 'one model prompt and terminal SSE (60s deadline)'
          modelEvidence.promptRequests++
          const prompted = await endpoint.fetch('/api/session/' + encodeURIComponent(sessionID) + '/prompt', { method: 'POST', headers,
            body: JSON.stringify({ text: readEvidence
              ? `Invoke read exactly once to read ${readEvidence.target}, then reply with exactly the file content, without formatting or commentary. Do not invoke any other tool.`
              : 'Reply with exactly MINIMAL_MODEL_OK. Do not invoke any tools.' }), signal: subscription.signal,
          })
          if (!prompted.ok) throw Error()
          await prompted.arrayBuffer()
          while (!completed && !failed && !subscription.signal.aborted) await delay(50)
          stage = completed ? 'terminal model evidence validation' : 'model SSE incomplete or rejected'
          modelEvidence.textMatched = finalText === (read ? readContent : 'MINIMAL_MODEL_OK')
          if (completed && !failed && !modelEvidence.textMatched) stage = 'terminal model exact-text mismatch'
          if (failed || subscription.signal.aborted || !completed || !modelEvidence.textMatched || modelEvidence.deltas < 1 ||
            (readEvidence ? readEvidence.calls !== 1 || readEvidence.successes !== 1 || !readEvidence.targetMatched || !readEvidence.contentMatched : modelEvidence.toolEvents !== 0)) throw Error()
        } finally {
          clearTimeout(deadline)
          subscription.abort()
          if (drain) {
            await bounded(drain, 5_000, 'Model SSE drain')
            modelEvidence.sseCleanup = 'aborted and joined'
          } else modelEvidence.sseCleanup = 'subscription aborted before drain'
        }
        if (failed || (!read && modelEvidence.toolEvents !== 0)) throw Error()
        pass(read ? 'one prompt, one successful local read with exact target/content, no other tools, execution succeeded; SSE joined' : 'one prompt streamed exact marker with deltas, no tools, execution succeeded; SSE joined')
      }
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
      if (readEvidence) readEvidence.managedStop = 'accepted'
      managedStop = undefined
      pass('managed stop accepted=true')
      stage = 'natural exit'
      const exit = await bounded(execution.exited, 20_000, 'Natural exit')
      if (readEvidence) {
        readEvidence.exit = { exitCode: exit.exitCode, forced: exit.forced, signal: exit.signal }
        readEvidence.cleanupExitStatus = exit.exitCode === 0 && !exit.forced && exit.signal === null ? 'natural exit verified' : 'unexpected exit'
      }
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
      if (modelEvidence) modelEvidence.cleanup = phaseResult.cleanup
      log('PASS ' + phase + ' full cleanup completed')
    }
    const last = phases[phases.length - 1]
    return { status: 'PASS', restart, sessionRetention, session, model, modelEvidence, ...(read ? { read, readEvidence } : {}), scope, runtime: manifest.version, checks, phases, database, exit: last.exit, outputBytes: last.outputBytes, assets: receipt.assets.length }
  } catch {
    // Error objects and response bodies can contain credentials; report only the checkpoint.
    return { status: 'FAIL', restart, sessionRetention, session, model, modelEvidence, ...(read ? { read, readEvidence } : {}), scope, error: 'Failed at ' + phase + ': ' + stage, checks, phases, database }
  } finally {
    try { await managedStop?.() } catch { if (readEvidence) readEvidence.managedStop = 'failed'; /* runtime.stop below remains mandatory */ }
    try { await runtime?.stop() }
    finally {
      try { await workspace?.flush() }
      finally { await workspace?.close() }
    }
    if (output) await bounded(output, 5_000, 'Cleanup drains')
    if (modelEvidence && modelEvidence.cleanup === 'pending') modelEvidence.cleanup = 'runtime.stop + workspace.flush + workspace.close completed'
  }
}

async function run() {
  const { runID, restart, sessionRetention, model, read = false } = await fetch('/run-config').then(r => r.json())
  if (new URL(location.href).searchParams.get('runID') !== runID) throw Error('Run ID mismatch; use the printed URL')
  if (typeof restart !== 'boolean' || new URL(location.href).searchParams.has('restart') !== restart) throw Error('Restart mode mismatch; use the printed URL')
  if (typeof sessionRetention !== 'boolean' || new URL(location.href).searchParams.has('session-retention') !== sessionRetention || (sessionRetention && !restart)) throw Error('Session retention mode mismatch; use the printed URL')
  if (typeof model !== 'boolean' || new URL(location.href).searchParams.has('model') !== model || (model && restart)) throw Error('Model mode mismatch; use the printed URL')
  if (typeof read !== 'boolean' || new URL(location.href).searchParams.has('read') !== read || (read && (!model || restart))) throw Error('Read mode mismatch; use the printed URL')
  let result
  try { result = await qualify(runID, restart, sessionRetention, model, read) }
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

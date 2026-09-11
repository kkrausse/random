import { Workspace, Runtime, opfsStore } from '../../workspace-api/src/index'
import type { Execution } from '../../workspace-api/src/types'

const hash = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(n => n.toString(16).padStart(2, '0')).join('')
async function bounded<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(`${label} timed out`)), ms) })]) }
  finally { clearTimeout(timer!) }
}

async function qualify() {
  const config = await fetch('/manifest').then(r => r.json())
  const abort = new AbortController()
  const result = {
    status: 'PENDING', runID: config.runID, runtime: config.runtime.version,
    primaryFailure: null as null | { stage: string; message: string }, secondaryFailures: [] as string[],
    stages: [] as { name: string; at: number; detail: unknown }[], lastStage: 'manifest',
    assets: [] as { file: string; bytes: number; sha256: string }[], exit: null as null | Awaited<Execution['exited']>,
    channels: Object.fromEntries(['stdout', 'stderr'].map(channel => [channel, { receivedBytes: 0, acknowledgedBytes: 0, chunks: 0, ended: false, errors: [] as string[], sha256: '' }])),
    cleanup: { executionStop: 'not needed', runtimeStop: 'pending', workspaceFlush: 'pending', workspaceClose: 'pending', drains: 'pending' },
    workerObservation: 'Public execution/Workspace errors and stream completion only; private worker exit/messageerror events are not exposed',
  }
  const chunks: Record<string, Uint8Array[]> = { stdout: [], stderr: [] }
  const texts: Record<string, string> = { stdout: '', stderr: '' }
  const listeners = new Set<() => void>()
  let workspace: Workspace | undefined, runtime: Runtime | undefined, execution: Execution | undefined
  let output: Promise<void> | undefined
  let reportQueue = Promise.resolve()
  const post = async (path: string, body: unknown) => {
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw Error(`${path} rejected: ${response.status}`)
    return response.json()
  }
  const fail = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    if (!result.primaryFailure) { result.primaryFailure = { stage: result.lastStage, message }; abort.abort(Error(message)) }
    else if (message !== result.primaryFailure.message) result.secondaryFailures.push(message)
    for (const listener of listeners) listener()
  }
  const stage = (name: string, detail: unknown = {}) => {
    result.lastStage = name
    const event = { name, at: Date.now(), detail }
    result.stages.push(event)
    document.querySelector('pre')!.textContent += name + '\n'
    reportQueue = reportQueue.then(() => post('/stage', { runID: config.runID, event })).then(() => {})
    void reportQueue.catch(fail)
    return reportQueue
  }
  const onError = (event: ErrorEvent) => fail(Error(`page error: ${event.message}`))
  const onRejection = (event: PromiseRejectionEvent) => fail(Error(`unhandled rejection: ${String(event.reason)}`))
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  const waitMarker = (marker: string) => new Promise<void>((done, reject) => {
    const check = () => {
      if (result.primaryFailure) { listeners.delete(check); reject(Error(result.primaryFailure.message)); return }
      if (texts.stdout.includes('background service boot failed')) { listeners.delete(check); reject(Error('Upstream background service boot failed; inspect stdout log')); return }
      if (texts.stdout.includes(marker)) { listeners.delete(check); done(); return }
      if (result.channels.stdout.ended) { listeners.delete(check); reject(Error(`stdout ended before ${marker}`)) }
    }
    listeners.add(check); check()
  })
  const drain = async (channel: string, stream: AsyncIterable<Uint8Array>) => {
    const decoder = new TextDecoder()
    try {
      for await (const value of stream) {
        const bytes = new Uint8Array(value)
        const stats = result.channels[channel]
        const offset = stats.receivedBytes
        stats.receivedBytes += bytes.length; stats.chunks++
        chunks[channel].push(bytes)
        texts[channel] += decoder.decode(bytes, { stream: true })
        // Separate loops upload/drain stdout and stderr concurrently. Each ack is
        // after host write+fsync; a rejected upload fails instead of dropping bytes.
        const response = await fetch(`/output/${channel}?runID=${config.runID}&offset=${offset}`, {
          method: 'POST', body: bytes, signal: AbortSignal.timeout(5000),
        })
        if (!response.ok) throw Error(`${channel} sink HTTP ${response.status}`)
        const ack = await response.json()
        if (ack.persistedBytes !== stats.receivedBytes) throw Error(`${channel} sink offset mismatch`)
        stats.acknowledgedBytes = ack.persistedBytes
        for (const listener of listeners) listener()
      }
      texts[channel] += decoder.decode()
      result.channels[channel].ended = true
    } catch (error) {
      result.channels[channel].errors.push(String(error)); fail(error)
    } finally { for (const listener of listeners) listener() }
  }
  const check = (ok: unknown, message: string) => { if (!ok) throw Error(message) }
  try {
    await bounded((async () => {
      check(crossOriginIsolated, 'Cross-origin isolation unavailable')
      const opfs = await navigator.storage.getDirectory()
      let entries = 0
      for await (const _ of opfs.values()) entries++
      check(entries === 0, 'Origin OPFS is not empty; refusing existing state')
      const manifestBytes = new Uint8Array(await fetch('/runtime/distribution.json').then(r => r.arrayBuffer()))
      check(await hash(manifestBytes) === config.runtime.manifestSha256, 'Distribution manifest hash mismatch')
      const manifest = JSON.parse(new TextDecoder().decode(manifestBytes))
      check(manifest.version === config.runtime.version && manifest.runtimeBuild.revision === config.runtime.revision, 'Runtime provenance mismatch')
      await stage('runtime.provenance-verified', config.runtime)
      const distribution = { name: 'vivari', version: manifest.version, assetBaseUrl: '/runtime/' }
      workspace = await Workspace.open({ id: 'default', storage: opfsStore(distribution), signal: abort.signal,
        onDiagnostic: event => { void stage('workspace.' + event.stage, event.detail ?? {}) },
      })
      check(workspace.persistence.status === 'durable', 'OPFS persistence not durable')
      check((await workspace.fs.readdir('/')).length === 0, 'Workspace not fresh')
      await stage('opfs.fresh-durable')
      for (const name of ['home', 'config', 'state', 'data', 'cache', 'tmp']) await workspace.fs.mkdir('/.server/' + name)
      runtime = await Runtime.start({ distribution, workspace, signal: abort.signal, tools: { delivery: {
        name: 'direct-server-assets', version: '1', async bind(context) {
          for (const asset of config.assets) {
            const response = await fetch('/app/' + encodeURIComponent(asset.file))
            check(response.ok, 'Application asset fetch failed')
            const bytes = new Uint8Array(await response.arrayBuffer())
            check(bytes.length === asset.bytes && await hash(bytes) === asset.sha256, 'Application asset integrity mismatch')
            await context.installFile('/app/' + asset.file, bytes)
            const installed = await context.readFile('/app/' + asset.file)
            check(installed.length === asset.bytes && await hash(installed) === asset.sha256, 'Installed asset integrity mismatch')
            result.assets.push(asset)
          }
          // Ordinary directory provisioning for the artifact's fixed database path.
          await context.installFile('/runtime-probe/.qualification', new TextEncoder().encode(config.runID))
          return async () => result.assets.length
        },
      } } })
      check(result.assets.length === 5, 'Expected exactly five unchanged app assets')
      await stage('assets.verified', result.assets)
      execution = await runtime.node({ entry: '/bin/bun.js', args: ['/app/server.js'], cwd: '/app', signal: abort.signal, env: {
        PATH: '/bin', HOME: '/workspace/.server/home', OPENCODE_TEST_HOME: '/workspace/.server/home',
        XDG_CONFIG_HOME: '/workspace/.server/config', XDG_STATE_HOME: '/workspace/.server/state',
        XDG_DATA_HOME: '/workspace/.server/data', XDG_CACHE_HOME: '/workspace/.server/cache', TMPDIR: '/workspace/.server/tmp',
        OPENCODE_PASSWORD: 'isolated-probe-only',
        OPENCODE_TREE_SITTER_WASM_PATH: '/app/tree-sitter.wasm',
        OPENCODE_TREE_SITTER_BASH_WASM_PATH: '/app/tree-sitter-bash.wasm',
        OPENCODE_TREE_SITTER_POWERSHELL_WASM_PATH: '/app/tree-sitter-powershell.wasm',
      } })
      output = Promise.all([drain('stdout', execution.stdout), drain('stderr', execution.stderr)]).then(() => {})
      void execution.exited.then(exit => { result.exit = exit; for (const listener of listeners) listener() }, fail)
      await stage('process.launched')
      const endpoint = await runtime.expose(4096, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]) })
      await stage('listener', { port: endpoint.port, url: endpoint.url })
      await waitMarker('OPENCODE_SERVER_PROCESS_READY')
      await stage('application.ready')
      check(result.channels.stderr.receivedBytes === 0, 'Unexpected guest stderr')
      const missing = await endpoint.fetch('/api/health', { signal: AbortSignal.timeout(5000) })
      await missing.arrayBuffer()
      check(missing.status === 401, 'Missing auth was not rejected')
      await stage('authentication.missing-rejected', { status: missing.status })
      const response = await endpoint.fetch('/api/health', { headers: { authorization: 'Basic ' + btoa('opencode:isolated-probe-only') }, signal: AbortSignal.timeout(5000) })
      const health = await response.json()
      check(response.status === 200 && health.healthy === true && health.version === '0.0.0-beta-19425' && Number.isInteger(health.pid) && health.pid > 0, 'Authenticated health mismatch')
      await stage('health.authenticated', { status: response.status, ...health })
      execution.closeStdin()
      await stage('stdin.eof-posted', { acknowledgment: 'public closeStdin returns void; later scope marker/exit establish behavior' })
      await waitMarker('OPENCODE_SERVER_PROCESS_SHUTDOWN_COMPLETE')
      await stage('application.scope-closed')
      result.exit = await bounded(execution.exited, 10000, 'Natural exit')
      check(result.exit.exitCode === 0 && result.exit.signal === null && result.exit.forced === false, 'Guest did not exit naturally')
      await stage('process.natural-exit', result.exit)
      await bounded(output, 5000, 'Output join')
      check(result.channels.stderr.receivedBytes === 0, 'Unexpected guest stderr')
    })(), 120000, 'Browser qualification')
  } catch (error) { fail(error) }
  finally {
    const cleanup = async (key: keyof typeof result.cleanup, action: () => Promise<unknown>) => {
      try { await bounded(action(), 5000, key); result.cleanup[key] = 'completed'; await stage('cleanup.' + key) }
      catch (error) { result.cleanup[key] = 'incomplete'; fail(error) }
    }
    if (execution && !result.exit) await cleanup('executionStop', () => execution!.stop())
    if (runtime) await cleanup('runtimeStop', () => runtime!.stop())
    if (workspace) {
      await cleanup('workspaceFlush', () => workspace!.flush())
      await cleanup('workspaceClose', () => workspace!.close())
    }
    if (output) await cleanup('drains', () => output!)
    for (const channel of ['stdout', 'stderr']) {
      const bytes = new Uint8Array(result.channels[channel].receivedBytes)
      let offset = 0
      for (const chunk of chunks[channel]) { bytes.set(chunk, offset); offset += chunk.length }
      result.channels[channel].sha256 = await hash(bytes)
    }
    try { await reportQueue } catch (error) { fail(error) }
    result.status = result.primaryFailure ? 'FAIL' : 'PASS'
    window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection)
    ;(window as unknown as { qualification: unknown }).qualification = result
    const ack = await post('/result', { runID: config.runID, result })
    document.querySelector('pre')!.textContent += `FINAL ${ack.status}\n`
  }
}

void qualify().catch(error => { document.querySelector('pre')!.textContent += 'REPORT FAILURE: ' + String(error) })

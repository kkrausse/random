import { Workspace, Runtime, opfsStore } from '../../workspace-api/src/index'
import { combinedFixture, combinedSteps, globFixtures } from './opencode-bun-fixtures'
import { combinedBytes, combinedEvidence, runCombined } from './opencode-bun-combined'
import { combinedTitle, projectHistory, sameHistory, retentionCheckpoints } from './opencode-bun-retention'
import type { HistoryProjection } from './opencode-bun-retention'

const log = (text: string) => { document.querySelector('pre')!.textContent += text + '\n' }
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function bounded<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(label + ' timed out')), ms) })]) }
  finally { clearTimeout(timer) }
}

async function qualify(runID: string, restart: boolean, sessionRetention: boolean, model: boolean, read: boolean, edit: boolean, grep: boolean, glob: boolean, mode: 'single' | 'combined-tools' = 'single', combinedRetention = false) {
  const combined = mode === 'combined-tools' ? combinedEvidence() : undefined
  const retention = combinedRetention ? { sessionID: '', title: combinedTitle, before: undefined as HistoryProjection | undefined, after: undefined as HistoryProjection | undefined,
    files: [] as { checkpoint: string; bytes: number; sha256: string }[], providerPosts: [] as number[], freshRegistration: false, freshEndpoint: false, oldEndpointRejected: false } : undefined
  let previousEndpointURL: string | undefined
  const needsRipgrep = grep || glob || !!combined
  let stage = 'manifest', runtime: Awaited<ReturnType<typeof Runtime.start>> | undefined
  let workspace: Awaited<ReturnType<typeof Workspace.open>> | undefined
  let output: Promise<unknown> | undefined
  const modelEvidence = model ? { providerID: 'opencode', id: 'muse-spark-1.3-contributor-free', deltas: 0, toolEvents: 0, promptRequests: 0, textMatched: false, textBlocks: 0, textLength: 0, trimmedTextMatched: false, lastBlockMatched: false, terminal: 'pending', sseCleanup: 'pending', cleanup: 'pending' } : undefined
  const readEvidence = read ? { target: '/workspace/read-probe.txt', calls: 0, successes: 0, targetMatched: false, contentMatched: false, providerExecuted: null as boolean | null, managedStop: 'pending', cleanupExitStatus: 'pending', exit: null as { exitCode: number; forced: boolean; signal: string | null } | null } : undefined
  const readContent = 'VIVARI_READ_PROBE_6ac6618_7f92d03b'
  const editBefore = 'VIVARI_EDIT_BEFORE', editAfter = 'VIVARI_EDIT_AFTER'
  const editEvidence = edit ? { target: '/workspace/edit-probe.txt', calls: 0, successes: 0, readCalls: 0, readSuccesses: 0, targetMatched: false, inputMatched: false, bytesMatched: false, beforeBytes: 0, beforeSha256: '', afterBytes: 0, afterSha256: '', providerExecuted: null as boolean | null, managedStop: 'pending', cleanupExitStatus: 'pending', exit: null as { exitCode: number; forced: boolean; signal: string | null } | null } : undefined
  const searchName = glob ? 'glob' : 'grep'
  const grepContent = glob ? '/workspace/glob-probe/match.ts' : 'Found 1 matches\n/workspace/grep-probe.txt:\n  Line 2: VIVARI_GREP_NEEDLE\n'
  // Shared ripgrep delivery and canonical tool-event validation for separate single-tool modes.
  const grepEvidence = needsRipgrep ? { target: glob ? '/workspace/glob-probe' : '/workspace/grep-probe.txt', calls: 0, successes: 0, inputMatched: false, pathMatched: false, contentMatched: false, contentItems: 0, contentSha256: '', matchedFiles: 0, fixtureFiles: 0, correlationMatched: false,
    seedBytes: 0, seedSha256: '', packageFiles: 0, manifestSha256: '', installerSha256: '', setupCheckpoint: false, setupStderrBytes: 0,
    setupExit: null as { exitCode: number; forced: boolean; signal: string | null } | null,
    providerExecuted: null as boolean | null, managedStop: 'pending', cleanupExitStatus: 'pending', exit: null as { exitCode: number; forced: boolean; signal: string | null } | null } : undefined
  const hashBytes = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(b => b.toString(16).padStart(2, '0')).join('')
  const toolCleanup = readEvidence ?? editEvidence ?? grepEvidence
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
        if (retention && combined) {
          stage = retentionCheckpoints.before
          await combinedBytes(combined, 'after', new Uint8Array(await workspace.fs.readFile(combinedFixture.path)), hashBytes)
          retention.files.push({ checkpoint: 'before runtime', bytes: combined.afterBytes, sha256: combined.afterSha256 })
          pass(retentionCheckpoints.before)
        }
        // A leftover registration must never qualify the new execution.
        stage = 'remove prior registration if retained'
        if ((await workspace.fs.readdir('/.server/state/opencode')).includes('service-local.json')) {
          await workspace.fs.remove('/.server/state/opencode/service-local.json')
        }
      }
      if (!workspace) throw Error()
      stage = 'writable guest directories'
      for (const path of ['home', 'config', 'state', 'data', 'cache', 'tmp']) await workspace.fs.mkdir('/.server/' + path)
      if (modelEvidence && phase === 'initial') {
        stage = 'model configuration'
        await workspace.fs.writeFile('/.server/config/opencode/opencode.json', JSON.stringify({
          model: 'opencode/' + modelEvidence.id, snapshots: false,
          providers: { opencode: { settings: { baseURL: `http://host.vivari.internal:${location.port}/api/model/opencode` } } },
          ...(combined ? { permissions: combinedSteps.map(({ name }) => ({ action: name, resource: '*', effect: 'allow' })) } : grep || glob ? { permissions: [{ action: searchName, resource: '*', effect: 'allow' }] } : read || edit ? { permissions: [{ action: 'read', resource: '*', effect: 'allow' }, ...(edit ? [{ action: 'edit', resource: '*', effect: 'allow' }] : [])] } : {}),
        }))
        if (read) await workspace.fs.writeFile('/read-probe.txt', readContent)
        if (combined) {
          stage = 'seed and verify combined target'
          await workspace.fs.mkdir('/combined-probe')
          await workspace.fs.writeFile(combinedFixture.path, combinedFixture.before)
          await combinedBytes(combined, 'before', new Uint8Array(await workspace.fs.readFile(combinedFixture.path)), hashBytes)
        } else if (grepEvidence) {
          stage = 'seed and verify ' + searchName + ' target'
          const fixtures = glob ? globFixtures : [['/grep-probe.txt', 'before\nVIVARI_GREP_NEEDLE\nafter\n']]
          if (glob) await workspace.fs.mkdir('/glob-probe')
          for (const [path, content] of fixtures) {
            const expected = new TextEncoder().encode(content)
            await workspace.fs.writeFile(path, expected)
            const bytes = new Uint8Array(await workspace.fs.readFile(path))
            if (bytes.length !== expected.length || !bytes.every((byte, i) => byte === expected[i])) throw Error()
            grepEvidence.seedBytes += bytes.length
            grepEvidence.fixtureFiles++
          }
          grepEvidence.seedSha256 = await hashBytes(new TextEncoder().encode(fixtures.map(([, content]) => content).join('')))
        }
        if (editEvidence) {
          stage = 'seed and verify edit target'
          await workspace.fs.writeFile('/edit-probe.txt', editBefore + '\n')
          const bytes = new Uint8Array(await workspace.fs.readFile('/edit-probe.txt'))
          const expected = new TextEncoder().encode(editBefore + '\n')
          if (bytes.length !== expected.length || !bytes.every((byte, i) => byte === expected[i])) throw Error()
          editEvidence.beforeBytes = bytes.length
          editEvidence.beforeSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('')
        }
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
          if (grepEvidence) {
            stage = 'verified unchanged nested ripgrep delivery'
            const nested = await fetch('/ripgrep-manifest').then(r => { if (!r.ok) throw Error(); return r.json() })
            if (nested.package !== 'ripgrep' || nested.version !== '0.3.1' || !Array.isArray(nested.transforms) || nested.transforms.length ||
              !Array.isArray(nested.assets) || nested.assets.length !== 9 || await hashBytes(new TextEncoder().encode(JSON.stringify(nested.assets))) !== nested.manifestSha256) throw Error()
            const seen = new Set<string>()
            for (const asset of nested.assets) {
              if (typeof asset.file !== 'string' || !/^ripgrep\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(asset.file) ||
                asset.file.split('/').some((part: string) => part === '.' || part === '..') || seen.has(asset.file) || asset.destination !== '/direct/node_modules/' + asset.file) throw Error()
              seen.add(asset.file)
              const response = await fetch('/ripgrep-package/' + encodeURIComponent(asset.file))
              if (!response.ok) throw Error()
              const bytes = new Uint8Array(await response.arrayBuffer())
              if (bytes.length !== asset.bytes || await hashBytes(bytes) !== asset.sha256) throw Error()
              await context.installFile(asset.destination, bytes)
            }
            const response = await fetch('/ripgrep-installer')
            if (!response.ok || nested.installer.destination !== '/direct/opencode-ripgrep-install.cjs') throw Error()
            const bytes = new Uint8Array(await response.arrayBuffer())
            if (bytes.length !== nested.installer.bytes || await hashBytes(bytes) !== nested.installer.sha256) throw Error()
            await context.installFile(nested.installer.destination, bytes)
            grepEvidence.packageFiles = seen.size
            grepEvidence.manifestSha256 = nested.manifestSha256
            grepEvidence.installerSha256 = nested.installer.sha256
          }
          return async () => receipt.assets.length
        },
      } } })
      pass('all app output mounted unchanged; length and SHA-256 verified')
      const env = {
        PATH: needsRipgrep ? '/direct/node_modules/.bin:/bin' : '/bin', ...(needsRipgrep ? { RIPGREP_NODE_WASI: '0' } : {}), HOME: '/workspace/.server/home', OPENCODE_TEST_HOME: '/workspace/.server/home',
        XDG_CONFIG_HOME: '/workspace/.server/config', XDG_STATE_HOME: '/workspace/.server/state',
        XDG_DATA_HOME: '/workspace/.server/data', XDG_CACHE_HOME: '/workspace/.server/cache',
        TMPDIR: '/workspace/.server/tmp', OPENCODE_DB: '/workspace/.server/data/opencode.sqlite',
        OPENCODE_DISABLE_FFF: '1', OPENCODE_DISABLE_FILEWATCHER: '1', OPENCODE_DISABLE_MODELS_FETCH: '1',
        ...(model ? { OPENCODE_MODELS_PATH: '/app/models.json' } : {}),
        OPENCODE_TREE_SITTER_WASM_PATH: '/app/tree-sitter.wasm',
        OPENCODE_TREE_SITTER_BASH_WASM_PATH: '/app/tree-sitter-bash.wasm',
        OPENCODE_TREE_SITTER_POWERSHELL_WASM_PATH: '/app/tree-sitter-powershell.wasm',
      }
      if (grepEvidence) {
        stage = 'ordinary ripgrep bin installation checkpoint'
        const setup = await runtime.node({ entry: '/direct/opencode-ripgrep-install.cjs', cwd: '/direct', env })
        const collect = async (stream: AsyncIterable<Uint8Array>) => {
          const decoder = new TextDecoder(); let text = ''
          for await (const bytes of stream) text += decoder.decode(bytes, { stream: true })
          return text + decoder.decode()
        }
        const setupOutput = Promise.all([collect(setup.stdout), collect(setup.stderr)])
        output = setupOutput
        void setupOutput.catch(() => {})
        void setup.exited.catch(() => {})
        setup.closeStdin()
        const exit = await bounded(setup.exited, 20_000, 'Ripgrep setup exit')
        const [stdout, stderr] = await bounded(setupOutput, 5_000, 'Ripgrep setup drains')
        grepEvidence.setupExit = { exitCode: exit.exitCode, forced: exit.forced, signal: exit.signal }
        grepEvidence.setupCheckpoint = stdout === 'OPENCODE_RIPGREP_INSTALL_PASS\n'
        grepEvidence.setupStderrBytes = new TextEncoder().encode(stderr).length
        if (!grepEvidence.setupCheckpoint || stderr !== '' || exit.exitCode !== 0 || exit.forced || exit.signal !== null) throw Error()
        output = undefined
        pass('nine unchanged ripgrep files verified; ordinary bin symlink/chmod checkpoint, empty stderr and clean setup exit')
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
      if (retention) {
        if (phase === 'reopened') {
          if (!previousEndpointURL || endpoint.url === previousEndpointURL) throw Error()
          retention.freshEndpoint = true
        }
        previousEndpointURL = endpoint.url
      }
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
      if (retention && phase === 'reopened') retention.freshRegistration = true
      pass('guest-generated registration validated (credentials omitted)')
      const headers = { authorization: 'Basic ' + btoa('opencode:' + registration.password), 'content-type': 'application/json' }
      if (toolCleanup) managedStop = async () => {
        const stopped = await endpoint.fetch('/api/service/stop', { method: 'POST', headers, body: JSON.stringify({ instanceID: registration.id }), signal: AbortSignal.timeout(20_000) })
        if (stopped.status !== 200 || (await stopped.json()).accepted !== true) throw Error('Managed cleanup stop failed')
        toolCleanup.managedStop = 'accepted'
        try {
          const exit = await bounded(execution.exited, 20_000, 'Managed cleanup exit')
          toolCleanup.exit = { exitCode: exit.exitCode, forced: exit.forced, signal: exit.signal }
          toolCleanup.cleanupExitStatus = exit.exitCode === 0 && !exit.forced && exit.signal === null ? 'natural exit verified' : 'unexpected exit'
        } catch { toolCleanup.cleanupExitStatus = 'exit unavailable within bound' }
      }
      stage = 'authenticated health'
      const health = await endpoint.fetch('/api/health', { headers, signal: AbortSignal.timeout(20_000) })
      if (health.status !== 200 || (await health.json()).healthy !== true) throw Error()
      pass('authenticated health healthy=true')
      if (combined && modelEvidence && phase === 'initial') {
        stage = 'combined one prompt and correlated terminal SSE (180s deadline)'
        await runCombined(endpoint, headers, combined, modelEvidence)
        pass('combined session created and one prompt completed with four ordered correlated local successes; SSE joined')
        stage = 'exact combined final bytes through workspace.fs'
        await combinedBytes(combined, 'after', new Uint8Array(await workspace.fs.readFile(combinedFixture.path)), hashBytes)
        pass('combined final bytes and SHA-256 verified through public workspace.fs')
      } else if (modelEvidence && phase === 'initial') {
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
        const editCalls = new Map<string, { name: 'read' | 'edit'; called: boolean; succeeded: boolean; assistantMessageID: string }>()
        const grepCalls = new Map<string, { called: boolean; succeeded: boolean; assistantMessageID: string }>()
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
                  if (editEvidence && event.type.startsWith('session.tool.')) {
                    // Pinned edit.Input: path/oldString/newString/optional replaceAll.
                    // Correlate canonical local success, not provider-executed calls or model prose.
                    if (event.type === 'session.tool.input.started') {
                      if (data.name === 'read') editEvidence.readCalls++
                      if (data.name === 'edit') editEvidence.calls++
                      if (!['read', 'edit'].includes(data.name) || typeof data.id !== 'string' || editCalls.has(data.id) ||
                        typeof data.assistantMessageID !== 'string' || editEvidence.readCalls > 2 || editEvidence.calls > 1) failed = true
                      else editCalls.set(data.id, { name: data.name, called: false, succeeded: false, assistantMessageID: data.assistantMessageID })
                    } else {
                      const call = editCalls.get(data.id)
                      if (!call || data.assistantMessageID !== call.assistantMessageID) failed = true
                      else if (event.type === 'session.tool.called') {
                        if (call.called || data.input?.path !== editEvidence.target || data.executed !== false) failed = true
                        else if (call.name === 'edit' && (data.input.oldString !== editBefore || data.input.newString !== editAfter ||
                          (data.input.replaceAll !== undefined && data.input.replaceAll !== false))) failed = true
                        else {
                          call.called = true
                          if (call.name === 'edit') { editEvidence.targetMatched = true; editEvidence.inputMatched = true }
                        }
                      } else if (event.type === 'session.tool.success') {
                        if (!call.called || call.succeeded || data.executed !== false || !Array.isArray(data.content) || !data.content.length) failed = true
                        else {
                          call.succeeded = true
                          if (call.name === 'read') editEvidence.readSuccesses++
                          else { editEvidence.successes++; editEvidence.providerExecuted = data.executed }
                        }
                      }
                    }
                    if (failed) modelEvidence.terminal = 'edit tool event rejected'
                  }
                  if (grepEvidence && event.type.startsWith('session.tool.')) {
                    // Pinned session-event schema: data.id is toolID; every tool event carries assistantMessageID.
                    if (event.type === 'session.tool.input.started') {
                      grepEvidence.calls++
                      if (data.name !== searchName || typeof data.id !== 'string' || !data.id || grepCalls.has(data.id) ||
                        typeof data.assistantMessageID !== 'string' || !data.assistantMessageID || grepEvidence.calls !== 1) failed = true
                      else grepCalls.set(data.id, { called: false, succeeded: false, assistantMessageID: data.assistantMessageID })
                    } else {
                      const call = grepCalls.get(data.id)
                      if (!call || data.assistantMessageID !== call.assistantMessageID) failed = true
                      else if (event.type === 'session.tool.called') {
                        if (call.called || data.executed !== false || data.input?.pattern !== (glob ? '*.ts' : 'VIVARI_GREP_NEEDLE') ||
                          data.input?.path !== grepEvidence.target || data.input?.limit !== 10 || Object.hasOwn(data.input, 'include') ||
                          Object.keys(data.input).some(key => !['pattern', 'path', 'limit'].includes(key))) failed = true
                        else { call.called = true; grepEvidence.inputMatched = true; grepEvidence.pathMatched = true }
                      } else if (event.type === 'session.tool.success') {
                        if (!call.called || call.succeeded || data.executed !== false || !Array.isArray(data.content)) failed = true
                        else {
                          call.succeeded = true; grepEvidence.successes++; grepEvidence.providerExecuted = data.executed
                          grepEvidence.contentItems = data.content.length
                          grepEvidence.contentMatched = data.content.length === 1 && data.content[0]?.type === 'text' && data.content[0].text === grepContent
                          if (data.content.length === 1 && typeof data.content[0]?.text === 'string') grepEvidence.contentSha256 = await hashBytes(new TextEncoder().encode(data.content[0].text))
                          if (!grepEvidence.contentMatched) failed = true
                          else { grepEvidence.correlationMatched = true; if (glob) grepEvidence.matchedFiles = 1 }
                        }
                      } else if (event.type === 'session.tool.progress') {
                        if (!call.called || call.succeeded) failed = true
                      } else if (!['session.tool.input.delta', 'session.tool.input.ended'].includes(event.type) || call.called) failed = true
                    }
                    if (failed) modelEvidence.terminal = searchName + ' tool event rejected'
                  }
                  if ((!read && !edit && !grep && !glob && event.type.startsWith('session.tool.')) || event.type === 'session.tool.failed' || event.type === 'session.execution.failed') {
                    failed = true
                    modelEvidence.terminal = event.type === 'session.execution.failed' ? event.type : 'tool event rejected'
                  }
                  if (event.type === 'session.text.delta') modelEvidence.deltas++
                  if (event.type === 'session.text.ended') {
                    if (typeof data.text !== 'string') failed = true
                    else {
                      finalText += data.text
                      // Comparison-only diagnostics: no visible text, reasoning, or provider state retained.
                      const expected = glob ? 'GLOB_PROBE_OK' : grep ? 'GREP_PROBE_OK' : edit ? 'EDIT_PROBE_OK' : read ? readContent : 'MINIMAL_MODEL_OK'
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
            body: JSON.stringify({ text: glob
              ? 'Invoke the upstream glob tool exactly once with pattern "*.ts", path "/workspace/glob-probe", and limit 10. Do not supply any other arguments or invoke any other tools. Finish by replying GLOB_PROBE_OK.'
              : grepEvidence
              ? 'Invoke grep exactly once with pattern "VIVARI_GREP_NEEDLE", path "/workspace/grep-probe.txt", and limit 10. Omit include. Do not invoke any other tools. Finish by replying GREP_PROBE_OK.'
              : editEvidence
              ? `Use the upstream edit tool exactly once on ${editEvidence.target} with oldString "${editBefore}" and newString "${editAfter}" (replaceAll omitted or false). Preserve the trailing newline. You may use read on this exact absolute path before editing and to verify afterward, at most twice total. Use this exact absolute path in every tool call. Do not invoke any other tools. Finish by replying EDIT_PROBE_OK.`
              : readEvidence
              ? `Invoke read exactly once to read ${readEvidence.target}, then reply with exactly the file content, without formatting or commentary. Do not invoke any other tool.`
              : 'Reply with exactly MINIMAL_MODEL_OK. Do not invoke any tools.' }), signal: subscription.signal,
          })
          if (!prompted.ok) throw Error()
          await prompted.arrayBuffer()
          while (!completed && !failed && !subscription.signal.aborted) await delay(50)
          stage = completed ? 'terminal model evidence validation' : 'model SSE incomplete or rejected'
          modelEvidence.textMatched = finalText === (glob ? 'GLOB_PROBE_OK' : grep ? 'GREP_PROBE_OK' : edit ? 'EDIT_PROBE_OK' : read ? readContent : 'MINIMAL_MODEL_OK')
          if (!edit && !grep && !glob && completed && !failed && !modelEvidence.textMatched) stage = 'terminal model exact-text mismatch'
          if (failed || subscription.signal.aborted || !completed || (!edit && !grep && !glob && !modelEvidence.textMatched) || modelEvidence.deltas < 1 ||
            (grepEvidence ? grepEvidence.calls !== 1 || grepEvidence.successes !== 1 || !grepEvidence.inputMatched || !grepEvidence.contentMatched ||
              (glob && (!grepEvidence.pathMatched || !grepEvidence.correlationMatched || grepEvidence.matchedFiles !== 1 || grepEvidence.fixtureFiles !== 2)) ||
              [...grepCalls.values()].some(call => !call.called || !call.succeeded) || modelEvidence.textBlocks < 1
              : editEvidence ? editEvidence.calls !== 1 || editEvidence.successes !== 1 || !editEvidence.targetMatched || !editEvidence.inputMatched ||
              editEvidence.readCalls !== editEvidence.readSuccesses || [...editCalls.values()].some(call => !call.called || !call.succeeded) || modelEvidence.textBlocks < 1 || !finalText.trim()
              : readEvidence ? readEvidence.calls !== 1 || readEvidence.successes !== 1 || !readEvidence.targetMatched || !readEvidence.contentMatched : modelEvidence.toolEvents !== 0)) throw Error()
          if (editEvidence) {
            stage = 'exact edit bytes through workspace.fs after terminal success'
            const bytes = new Uint8Array(await workspace.fs.readFile('/edit-probe.txt'))
            const expected = new TextEncoder().encode(editAfter + '\n')
            editEvidence.afterBytes = bytes.length
            editEvidence.afterSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('')
            editEvidence.bytesMatched = bytes.length === expected.length && bytes.every((byte, i) => byte === expected[i])
            if (!editEvidence.bytesMatched) throw Error()
          }
        } finally {
          clearTimeout(deadline)
          subscription.abort()
          if (drain) {
            await bounded(drain, 5_000, 'Model SSE drain')
            modelEvidence.sseCleanup = 'aborted and joined'
          } else modelEvidence.sseCleanup = 'subscription aborted before drain'
        }
        if (failed || (!read && !edit && !grep && !glob && modelEvidence.toolEvents !== 0)) throw Error()
        pass(grep || glob ? 'one prompt, one successful local ' + searchName + ' with exact input/content, no other tools, streamed execution succeeded; SSE joined' : edit ? 'one prompt, one successful local edit, bounded same-file reads, exact final bytes, streamed completion and execution succeeded; SSE joined' : read ? 'one prompt, one successful local read with exact target/content, no other tools, execution succeeded; SSE joined' : 'one prompt streamed exact marker with deltas, no tools, execution succeeded; SSE joined')
      }
      if (retention && combined) {
        stage = phase === 'initial' ? retentionCheckpoints.captured : retentionCheckpoints.after
        const sessionResponse = await endpoint.fetch('/api/session/' + encodeURIComponent(combined.sessionID), { headers, signal: AbortSignal.timeout(20_000) })
        if (!sessionResponse.ok) throw Error()
        const info = (await sessionResponse.json()).data
        if (info?.id !== combined.sessionID || info.title !== combinedTitle) throw Error()
        retention.sessionID = info.id
        const response = await endpoint.fetch('/api/session/' + encodeURIComponent(combined.sessionID) + '/context', { headers, signal: AbortSignal.timeout(20_000) })
        if (!response.ok) throw Error()
        const history = await projectHistory((await response.json()).data, combined.events, hashBytes)
        if (phase === 'initial') retention.before = history
        else {
          retention.after = history
          sameHistory(retention.before!, history)
          await combinedBytes(combined, 'after', new Uint8Array(await workspace.fs.readFile(combinedFixture.path)), hashBytes)
          retention.files.push({ checkpoint: 'after health', bytes: combined.afterBytes, sha256: combined.afterSha256 })
        }
        pass(stage)
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
      if (toolCleanup) toolCleanup.managedStop = 'accepted'
      managedStop = undefined
      pass('managed stop accepted=true')
      stage = 'natural exit'
      const exit = await bounded(execution.exited, 20_000, 'Natural exit')
      if (toolCleanup) {
        toolCleanup.exit = { exitCode: exit.exitCode, forced: exit.forced, signal: exit.signal }
        toolCleanup.cleanupExitStatus = exit.exitCode === 0 && !exit.forced && exit.signal === null ? 'natural exit verified' : 'unexpected exit'
      }
      const outputBytes = await bounded(output, 5_000, 'Output drains')
      if (exit.exitCode !== 0 || exit.forced || exit.signal !== null) throw Error()
      pass('natural exitCode=0 forced=false signal=null before cleanup')
      const phaseResult = { phase, checks: checks.slice(checksStart), exit, outputBytes, cleanup: 'pending' }
      phases.push(phaseResult)
      stage = 'runtime.stop'
      await runtime.stop()
      runtime = undefined
      if (retention && phase === 'initial') {
        stage = retentionCheckpoints.endpoint
        try { await endpoint.fetch('/api/health', { headers, signal: AbortSignal.timeout(3_000) }) }
        catch (error) { retention.oldEndpointRejected = !!error && typeof error === 'object' && 'code' in error && error.code === 'CLOSED' }
        if (!retention.oldEndpointRejected) throw Error()
        pass(stage); phaseResult.checks.push(stage)
      }
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
      if (retention) {
        stage = retentionCheckpoints.posts
        const response = await fetch('/retention-posts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runID, phase }) })
        if (!response.ok) throw Error()
        retention.providerPosts.push((await response.json()).modelPosts)
        if (phase === 'reopened') {
          if (retention.providerPosts[0] !== retention.providerPosts[1]) throw Error()
          pass(stage); phaseResult.checks.push(stage)
        }
      }
      if (modelEvidence) modelEvidence.cleanup = phaseResult.cleanup
      log('PASS ' + phase + ' full cleanup completed')
    }
    const last = phases[phases.length - 1]
    return { status: 'PASS', ...(retention ? { combinedRetention, retention } : {}), restart, sessionRetention, session, model, modelEvidence, ...(combined ? { mode, combinedEvidence: combined, deliveryEvidence: grepEvidence } : {}), ...(read ? { read, readEvidence } : {}), ...(edit ? { edit, editEvidence } : {}), ...(grep ? { grep, grepEvidence } : {}), ...(glob ? { glob, globEvidence: grepEvidence } : {}), scope, runtime: manifest.version, checks, phases, database, exit: last.exit, outputBytes: last.outputBytes, assets: receipt.assets.length }
  } catch {
    // Error objects and response bodies can contain credentials; report only the checkpoint.
    return { status: 'FAIL', restart, sessionRetention, session, model, modelEvidence, ...(combined ? { mode, combinedEvidence: combined, deliveryEvidence: grepEvidence } : {}), ...(read ? { read, readEvidence } : {}), ...(edit ? { edit, editEvidence } : {}), ...(grep ? { grep, grepEvidence } : {}), ...(glob ? { glob, globEvidence: grepEvidence } : {}), scope, error: 'Failed at ' + phase + ': ' + stage, checks, phases, database }
  } finally {
    try { await managedStop?.() } catch { if (toolCleanup) toolCleanup.managedStop = 'failed'; /* runtime.stop below remains mandatory */ }
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
  const { runID, restart, sessionRetention, model, read = false, edit = false, grep = false, glob = false, mode = 'single', combinedRetention = false } = await fetch('/run-config').then(r => r.json())
  if (new URL(location.href).searchParams.has('combined-retention') !== combinedRetention || (combinedRetention && (mode !== 'combined-tools' || !restart || sessionRetention))) throw Error('Combined retention mode mismatch')
  if (!['single', 'combined-tools'].includes(mode) || new URL(location.href).searchParams.has('combined-tools') !== (mode === 'combined-tools') ||
    (mode === 'combined-tools' && (!model || (restart && !combinedRetention) || sessionRetention || read || edit || grep || glob))) throw Error('Combined mode mismatch; use the printed URL')
  if (new URL(location.href).searchParams.get('runID') !== runID) throw Error('Run ID mismatch; use the printed URL')
  if (typeof restart !== 'boolean' || new URL(location.href).searchParams.has('restart') !== restart) throw Error('Restart mode mismatch; use the printed URL')
  if (typeof sessionRetention !== 'boolean' || new URL(location.href).searchParams.has('session-retention') !== sessionRetention || (sessionRetention && !restart)) throw Error('Session retention mode mismatch; use the printed URL')
  if (typeof model !== 'boolean' || new URL(location.href).searchParams.has('model') !== model || (model && restart && !combinedRetention)) throw Error('Model mode mismatch; use the printed URL')
  if (typeof read !== 'boolean' || new URL(location.href).searchParams.has('read') !== read || (read && (!model || restart))) throw Error('Read mode mismatch; use the printed URL')
  if (typeof edit !== 'boolean' || new URL(location.href).searchParams.has('edit') !== edit || (edit && (!model || restart || read))) throw Error('Edit mode mismatch; use the printed URL')
  if (typeof grep !== 'boolean' || new URL(location.href).searchParams.has('grep') !== grep || (grep && (!model || restart || read || edit))) throw Error('Grep mode mismatch; use the printed URL')
  if (typeof glob !== 'boolean' || new URL(location.href).searchParams.has('glob') !== glob || (glob && (!model || restart || sessionRetention || read || edit || grep))) throw Error('Glob mode mismatch; use the printed URL')
  let result
  try { result = await qualify(runID, restart, sessionRetention, model, read, edit, grep, glob, mode, combinedRetention) }
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

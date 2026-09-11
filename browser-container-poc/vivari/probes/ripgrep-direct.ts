import { Workspace, Runtime, opfsStore } from '../../workspace-api/src/index'

const log = (text: string) => { document.querySelector('pre')!.textContent += text + '\n' }

async function qualify() {
  const manifest = await fetch('/runtime/distribution.json').then(response => response.json())
  const distribution = { name: 'vivari', version: manifest.version, assetBaseUrl: '/runtime/' }
  const workspace = await Workspace.open({ id: 'default', storage: opfsStore(distribution) })
  let runtime: Awaited<ReturnType<typeof Runtime.start>> | undefined
  try {
    const used = await workspace.fs.stat('/ripgrep-direct-run.json').then(() => true, () => false)
    if (used) throw Error('Use a fresh localhost port for qualification')
    await workspace.fs.writeFile('/ripgrep-direct-run.json', JSON.stringify({runtime:manifest.version}))
    const receipt = await fetch('/package-manifest').then(response => response.json())
    runtime = await Runtime.start({ distribution, workspace, tools: { delivery: {
      name: 'ripgrep-direct-delivery', version: '1', async bind(context) {
        for (const asset of receipt.assets) {
          const response = await fetch('/package/' + asset.file)
          if (!response.ok) throw Error(`Package HTTP ${response.status}: ${asset.file}`)
          const bytes = new Uint8Array(await response.arrayBuffer())
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
          if (hash !== asset.sha256 || bytes.length !== asset.bytes) throw Error('Package integrity: ' + asset.file)
          await context.installFile('/direct/node_modules/' + asset.file, bytes)
        }
        const fixture = await fetch('/guest-probe.mjs')
        if (!fixture.ok) throw Error('Guest fixture unavailable')
        await context.installFile('/direct/probe.mjs', new Uint8Array(await fixture.arrayBuffer()))
        const command = await fetch('/guest-command.cjs')
        if (!command.ok) throw Error('Guest command fixture unavailable')
        await context.installFile('/direct/command.cjs', new Uint8Array(await command.arrayBuffer()))
        await context.installFile('/direct/fixture.txt', new TextEncoder().encode('DIRECT_SEARCH_NEEDLE\n'))
        await context.installFile('/tmp/.direct-probe', new Uint8Array())
        return () => receipt.assets.length
      },
    } } })
    log(`Mounted ${runtime.tools.delivery()} unchanged package files; runtime ${manifest.version}`)
    const results = []
    for (const mode of ['cold', 'warm', 'command']) {
      const execution = await runtime.node({ entry: mode === 'command' ? '/direct/command.cjs' : '/direct/probe.mjs', args: [mode], cwd: '/direct', env: { TMPDIR: '/tmp' }, signal: AbortSignal.timeout(60_000) })
      const read = async (stream: AsyncIterable<Uint8Array>) => {
        const decoder = new TextDecoder()
        let text = ''
        for await (const bytes of stream) text += decoder.decode(bytes, { stream: true })
        return text + decoder.decode()
      }
      const [stdout, stderr, exit] = await Promise.all([read(execution.stdout), read(execution.stderr), execution.exited])
      log(JSON.stringify({ mode, stdout, stderr, exit }))
      const checkpoint = mode === 'command' ? 'RIPGREP_COMMAND_PASS' : `RIPGREP_DIRECT_${mode.toUpperCase()}_PASS`
      if (exit.exitCode !== 0 || exit.forced || !stdout.includes(checkpoint)) throw Error(`${mode} failed: ${stderr || stdout}`)
      results.push({ mode, stdout, stderr, exit })
    }
    const result = { status: 'PASS', runtime: manifest.version, package: receipt.package, transforms: [], results }
    log('RESULT ' + JSON.stringify(result))
    return result
  } finally {
    await runtime?.stop()
    await workspace.close()
  }
}

Object.assign(window, { qualifyRipgrepDirect: qualify })

// One browser navigation is sufficient: report completion to the waiting host.
if (new URL(location.href).searchParams.has('autorun')) {
  const { runID } = await fetch('/run-config').then(response => response.json())
  let result
  try { result = await qualify() }
  catch (error) { result = {status:'FAIL',error:String(error),stack:error instanceof Error ? error.stack : undefined} }
  Object.assign(window, { ripgrepDirectResult: result })
  const response = await fetch('/result', { method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({runID,result,log:document.querySelector('pre')!.textContent}) })
  if (!response.ok) throw Error('Result reporting failed: HTTP ' + response.status)
}

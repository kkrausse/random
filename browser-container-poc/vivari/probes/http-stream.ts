import { Workspace, Runtime, opfsStore } from '../../workspace-api/src/index'

export async function qualifyHttpStreaming() {
  const log = (text: string) => { document.querySelector('pre')!.textContent += text + '\n' }
  const manifest = await fetch('/runtime/distribution.json').then(r => r.json())
  const distribution = { name: 'vivari', version: manifest.version, assetBaseUrl: '/runtime/' }
  const workspace = await Workspace.open({ id: 'default', storage: opfsStore(distribution) })
  const runtime = await Runtime.start({ workspace, distribution })
  try {
    await workspace.fs.writeFile('/http-stream.cjs', await fetch('/http-stream-server.cjs').then(r => r.text()))
    let server = await runtime.node({ entry: '/workspace/http-stream.cjs' })
    const drain = async (stream: AsyncIterable<Uint8Array>) => { for await (const bytes of stream) log(new TextDecoder().decode(bytes)) }
    let output = Promise.all([drain(server.stdout), drain(server.stderr)])
    let endpoint = await runtime.expose(3187, { signal: AbortSignal.timeout(10000) })
    const checks = '/http-stream-checks.js'
    const { checkHttpStreaming } = await import(checks)
    const result = await checkHttpStreaming(endpoint.fetch, { checkpoint: log })
    if ((await navigator.serviceWorker.getRegistrations()).length) throw Error('Programmatic HTTP registered a Service Worker')
    log('PASS programmatic HTTP without Service Worker')
    const iframe = document.createElement('iframe')
    document.body.append(iframe)
    const preview = endpoint.attachPreview(iframe)
    try {
      const deadline = Date.now() + 15000
      while (!iframe.contentDocument?.querySelector('h1') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50))
      if (iframe.contentDocument?.querySelector('h1')?.textContent !== 'HTTP_PREVIEW_PASS') throw Error('Lazy preview attachment failed')
      log('PASS lazy preview registration/navigation')
    } finally { preview.dispose(); iframe.remove() }
    const retired = endpoint
    const shutdown = await endpoint.fetch('/shutdown')
    await endpoint.closed
    if (await shutdown.text() !== 'graceful') throw Error('Graceful response did not drain')
    await output
    if ((await server.exited).exitCode !== 0) throw Error('Graceful process exit failed')
    server = await runtime.node({ entry: '/workspace/http-stream.cjs' })
    output = Promise.all([drain(server.stdout), drain(server.stderr)])
    endpoint = await runtime.expose(3187, { signal: AbortSignal.timeout(10000) })
    if (endpoint.url === retired.url) throw Error('Listener identity reused')
    let oldRejected = false
    try { await retired.fetch('/json') } catch { oldRejected = true }
    if (!oldRejected) throw Error('Old endpoint retargeted')
    log('PASS graceful response drain/clean exit/listener replacement')
    const response = await endpoint.fetch('/sse')
    const reader = response.body!.getReader()
    await reader.read()
    await server.stop(); await output
    let rejected = false
    try { await reader.read() } catch { rejected = true }
    if (!rejected) throw Error('Process exit did not fail active request')
    log('PASS process exit fails active request')
    log('RESULT ' + JSON.stringify(result))
    return { ...result, runtime: manifest.version }
  } finally { await runtime.stop(); await workspace.flush(); await workspace.close() }
}
Object.assign(window, { qualifyHttpStreaming })

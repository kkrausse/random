const root = document.getElementById('root')
const describe = (reason: unknown) => reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'Unknown JavaScript startup failure'

const report = (reason: unknown) => {
  const message = describe(reason)
  if (root) {
    root.innerHTML = ''
    const panel = document.createElement('main')
    panel.setAttribute('role', 'alert')
    panel.style.cssText = 'font:16px system-ui;padding:24px;color:#7f1d1d;background:#fef2f2;min-height:100vh;box-sizing:border-box'
    const heading = document.createElement('h1')
    heading.textContent = 'Workout UI failed to start'
    const detail = document.createElement('pre')
    detail.style.whiteSpace = 'pre-wrap'
    detail.textContent = message
    panel.append(heading, detail)
    root.append(panel)
  }
  const event = { id: `web-startup-${Date.now()}`, timestamp: new Date().toISOString(), subsystem: 'web-startup', level: 'error', message }
  void fetch('/__workout/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ formatVersion: 1, uploadId: event.id, events: [event] }) }).catch(() => undefined)
}

window.addEventListener('error', (event) => report(event.error ?? event.message))
window.addEventListener('unhandledrejection', (event) => report(event.reason))
void import('./start').catch(report)

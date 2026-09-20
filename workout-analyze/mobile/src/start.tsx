import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createBridgeClient, nativeTransport, unavailableNativeTransport } from './bridge/client'
import { createSimulatorTransport } from './bridge/simulator'
import { createMobileStore } from './store'
import './styles.css'

const params = new URLSearchParams(window.location.search)
const native = nativeTransport()
const simulatorRequested = params.get('simulator') === '1' || params.has('fault')
const transport = native ?? (simulatorRequested ? createSimulatorTransport(params.get('fault')) : unavailableNativeTransport())
const client = createBridgeClient(transport)
const store = createMobileStore(client)
if (import.meta.env.DEV) {
  const kind = native ? 'native' : simulatorRequested ? 'simulator' : 'unavailable'
  void import('./dev/runner').then(({ installDevRunner }) => installDevRunner({ client, store, kind })).catch((error) => {
    console.warn('Optional iPhone development runner did not start', error instanceof Error ? error.message : error)
  })
}
const stopStore = store.getState().start()
window.addEventListener('pagehide', () => { stopStore(); client.dispose() }, { once: true })

const root = document.getElementById('root')
if (!root) throw new Error('Mobile application root is missing')
createRoot(root).render(<StrictMode><App store={store} /></StrictMode>)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createBridgeClient, nativeTransport, unavailableNativeTransport } from './bridge/client'
import { createMobileStore } from './store'
import { createRecoveredArchiveClient } from './archive/client'
import { createLocalDatabaseHost } from './database/client'
import './styles.css'

const params = new URLSearchParams(window.location.search)
const native = nativeTransport()
const transport = native ?? unavailableNativeTransport()
const client = createBridgeClient(transport)
const localArchive = import.meta.env.DEV && !native ? createRecoveredArchiveClient() : undefined
const localDatabase = import.meta.env.DEV && !native ? createLocalDatabaseHost() : undefined
const store = createMobileStore(client, localArchive, localDatabase)
if (import.meta.env.DEV) {
  const kind = native ? 'native' : 'unavailable'
  void import('./dev/runner').then(({ installDevRunner }) => installDevRunner({ client, store, kind })).catch((error) => {
    console.warn('Optional iPhone development runner did not start', error instanceof Error ? error.message : error)
  })
}
const stopStore = store.getState().start()
if (import.meta.env.DEV && params.get('replay') === 'local') void store.getState().loadLocalReplay()
window.addEventListener('pagehide', () => { stopStore(); client.dispose() }, { once: true })

const root = document.getElementById('root')
if (!root) throw new Error('Mobile application root is missing')
createRoot(root).render(<StrictMode><App store={store} /></StrictMode>)

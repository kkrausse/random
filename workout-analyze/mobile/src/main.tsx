import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createBridgeClient, nativeTransport, unavailableNativeTransport } from './bridge/client'
import { createSimulatorTransport } from './bridge/simulator'
import './styles.css'

const params = new URLSearchParams(window.location.search)
const native = nativeTransport()
const isBrowserOrigin = window.location.protocol === 'http:' || window.location.protocol === 'https:'
const transport = native ?? (isBrowserOrigin ? createSimulatorTransport(params.get('fault')) : unavailableNativeTransport())
const client = createBridgeClient(transport)

createRoot(document.getElementById('root')!).render(<StrictMode><App client={client} /></StrictMode>)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createBridgeClient, nativeTransport } from './bridge/client'
import { createSimulatorTransport } from './bridge/simulator'
import './styles.css'

const params = new URLSearchParams(window.location.search)
const transport = nativeTransport() ?? createSimulatorTransport(params.get('fault'))
const client = createBridgeClient(transport)

createRoot(document.getElementById('root')!).render(<StrictMode><App client={client} /></StrictMode>)

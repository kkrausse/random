import { ArrowLeft, CheckCircle2, ChevronRight, CircleAlert, Download, Gauge, HeartPulse, MapPin, RefreshCw, RotateCcw, Settings as SettingsIcon, Share2, ShieldCheck, Wifi } from 'lucide-react'
import { useState } from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { Capability, StatusRow } from '../../src/shared/mobile'
import type { MobileStore } from './store'
import { Button } from './components/Button'
import { defaultManifestUrl, recommendedDevelopmentUrl } from './config'

const age = (value: string | null) => {
  if (!value) return 'Never observed'
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`
}
const StatusIcon = ({ status }: { status: StatusRow['status'] }) => status === 'ok' ? <CheckCircle2 /> : <CircleAlert />
const TopBar = ({ title, back, action }: { title: string; back?: () => void; action?: React.ReactNode }) => <header className="topbar"><div>{back && <button className="icon-button" onClick={back} aria-label="Back"><ArrowLeft /></button>}</div><strong>{title}</strong><div>{action}</div></header>
const Pill = ({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) => <span className={`pill pill-${tone}`}>{children}</span>
const pending = (requests: Readonly<Record<string, { status: string }>>, prefix?: string) => Object.entries(requests).some(([key, value]) => value.status === 'pending' && (!prefix || key.startsWith(prefix)))

export const App = ({ store }: { store: MobileStore }) => {
  const screen = useStore(store, (state) => state.screen)
  return screen === 'settings' ? <Settings store={store} /> : <Diagnostics store={store} />
}

const Settings = ({ store }: { store: MobileStore }) => {
  const bridge = useStore(store, (state) => state.bridge)
  const builds = useStore(store, (state) => state.builds)
  const requests = useStore(store, (state) => state.requests)
  const notice = useStore(store, (state) => state.notices.settings)
  const devUrl = useStore(store, (state) => state.developmentSourceDraft)
  const configuredDevUrl = useStore(store, (state) => state.configuredDevelopmentSourceUrl)
  const uiSource = useStore(store, (state) => state.uiSource)
  const setScreen = useStore(store, (state) => state.setScreen)
  const setDevUrl = useStore(store, (state) => state.setDevelopmentSourceDraft)
  const reload = useStore(store, (state) => state.reload)
  const configureSource = useStore(store, (state) => state.configureDevelopmentSource)
  const installBuild = useStore(store, (state) => state.installBuild)
  const rollback = useStore(store, (state) => state.rollback)
  const [manifestUrl, setManifestUrl] = useState(defaultManifestUrl)
  const busy = pending(requests)
  const configuredSource = uiSource?.configured.kind === 'development' ? uiSource.configured.url : uiSource ? `${uiSource.configured.kind} build ${uiSource.configured.buildId}` : 'Waiting for native source state…'
  const loadedSource = uiSource?.loadedUrl ?? (uiSource ? 'None in this process' : 'Waiting for native source state…')
  return <main className="app-shell">
    <TopBar title="Settings" back={() => setScreen('diagnostics')} />
    <section className="page-heading"><p className="eyebrow">SHELL & DELIVERY</p><h1>App source</h1><p>Switch web code without reinstalling the native shell. Engine changes take effect for the next session.</p></section>
    <section className="card build-card"><div className="card-title"><Wifi /><div><span>Configured source</span><strong>{configuredSource}</strong></div><Pill tone={uiSource?.loadState === 'failed' ? 'error' : 'good'}>{uiSource?.loadState ?? bridge.phase}</Pill></div><dl><div><dt>Current target</dt><dd>{uiSource?.targetUrl ?? '—'}</dd></div><div><dt>Loaded source</dt><dd>{loadedSource}</dd></div><div><dt>Build source</dt><dd>{builds ? `${builds.active.source} · ${builds.active.buildId}` : '—'}</dd></div><div><dt>Engine</dt><dd>{builds?.active.engineBuildId ?? '—'}</dd></div></dl>{uiSource?.currentFailure && <p className="error-note">Current load failed: {uiSource.currentFailure}</p>}{!uiSource?.currentFailure && uiSource?.lastFailureHistory && <p className="error-note">Previous load failure: {uiSource.lastFailureHistory}</p>}{builds?.lastFailure && <p className="error-note">Build operation: {builds.lastFailure}</p>}</section>
    <section className="form-section"><label htmlFor="dev-url">Development server URL</label><div className="input-row"><input id="dev-url" value={devUrl} placeholder={recommendedDevelopmentUrl} onChange={(event) => setDevUrl(event.target.value)} inputMode="url" autoCapitalize="none" /><Button disabled={busy || devUrl.length === 0} onClick={() => void configureSource(devUrl)}><Wifi /> Connect</Button></div>{configuredDevUrl === null && <Button disabled={busy || devUrl === recommendedDevelopmentUrl} onClick={() => setDevUrl(recommendedDevelopmentUrl)}>Use private tailnet HTTPS</Button>}<small>Changing this draft does not switch sources. Connect explicitly to apply it.</small></section>
    <section className="form-section"><label htmlFor="manifest-url">HTTPS build manifest</label><input id="manifest-url" value={manifestUrl} onChange={(event) => setManifestUrl(event.target.value)} inputMode="url" autoCapitalize="none" /><Button className="full" disabled={busy} onClick={() => void installBuild(manifestUrl)}><Download /> Download, activate & reload</Button></section>
    <section className="action-list">
      <button onClick={() => void reload()} disabled={busy}><RefreshCw /><span><strong>Reload current UI</strong><small>Reconnects to native session state</small></span><ChevronRight /></button>
      <button onClick={() => void rollback('previous')} disabled={busy || !builds?.previous}><RotateCcw /><span><strong>Use previous build</strong><small>{builds?.previous?.buildId ?? 'No previous build available'}</small></span><ChevronRight /></button>
      <button onClick={() => void rollback('bundled')} disabled={busy}><ShieldCheck /><span><strong>Use bundled build</strong><small>{builds?.bundled.buildId ?? 'Known-good fallback'}</small></span><ChevronRight /></button>
      <button onClick={() => setScreen('diagnostics')}><Gauge /><span><strong>Diagnostics</strong><small>Native health, checks, and export</small></span><ChevronRight /></button>
    </section>
    {notice && <p className="notice" role="status">{notice}</p>}
  </main>
}

const Diagnostics = ({ store }: { store: MobileStore }) => {
  const bridge = useStore(store, (state) => state.bridge)
  const snapshot = useStore(store, (state) => state.diagnostics)
  const checks = useStore(store, (state) => state.checks)
  const requests = useStore(store, (state) => state.requests)
  const notice = useStore(store, (state) => state.notices.diagnostics)
  const setScreen = useStore(store, (state) => state.setScreen)
  const runChecks = useStore(store, (state) => state.runChecks)
  const exportDiagnostics = useStore(store, (state) => state.exportDiagnostics)
  const busy = pending(requests, 'diagnostics-')
  return <main className="app-shell diagnostics-screen">
    <TopBar title="Diagnostics" action={<button className="icon-button" onClick={() => setScreen('settings')} aria-label="Build and source utilities"><SettingsIcon /></button>} />
    <section className="page-heading"><Pill tone={bridge.transport === 'simulator' ? 'warning' : 'good'}>{bridge.transportLabel}</Pill><h1>Native health</h1><p>Read-only observations. This page never starts sensors, prompts for permission, or mutates a workout.</p><Button className="utility-link" onClick={() => setScreen('settings')}><SettingsIcon /> Build & source utilities</Button></section>
    <section className="summary-strip"><div><strong>{snapshot?.rows.filter((item) => item.status === 'ok').length ?? '—'}</strong><span>OK</span></div><div><strong>{snapshot?.rows.filter((item) => item.status === 'waiting').length ?? '—'}</strong><span>WAITING</span></div><div><strong>{snapshot?.rows.filter((item) => ['error', 'unavailable'].includes(item.status)).length ?? '—'}</strong><span>ATTENTION</span></div></section>
    {bridge.error && <p className="notice notice-error" role="alert">Native bridge: {bridge.error}</p>}
    <SensorHarness store={store} />
    <section className="diagnostic-list">{snapshot?.rows.map((item) => <article key={item.id} className={`diagnostic-row status-${item.status}`}><StatusIcon status={item.status} /><div><div className="row-title"><strong>{item.label}</strong><Pill tone={item.status}>{item.status}</Pill></div><p>{item.reason}</p><small>{item.freshness} · {age(item.observedAt)}</small></div></article>) ?? <p>Reading native snapshot…</p>}</section>
    {checks.length > 0 && <section className="checks"><p className="eyebrow">LAST CHECK RUN</p>{checks.map((check) => <div key={check.id}><CheckCircle2 /><span><strong>{check.id}</strong><small>{check.reason}</small></span><Pill tone={check.outcome === 'pass' ? 'good' : 'error'}>{check.outcome}</Pill></div>)}</section>}
    <div className="sticky-actions"><Button variant="primary" onClick={() => void runChecks()} disabled={busy || bridge.phase !== 'ready'}><ShieldCheck /> Run isolated checks</Button><Button onClick={() => void exportDiagnostics()} disabled={busy || bridge.phase !== 'ready'}><Share2 /> Export diagnostics</Button><small>Export excludes workout observations by default.</small></div>
    {notice && <p className="notice" role="status">{notice}</p>}
  </main>
}

const SensorHarness = ({ store }: { store: MobileStore }) => {
  const bridge = useStore(store, (state) => state.bridge)
  const permissions = useStore(store, (state) => state.permissions)
  const location = useStore(store, (state) => state.location)
  const heartRate = useStore(store, (state) => state.heartRate)
  const locations = useStore(store, (state) => state.locations)
  const measurements = useStore(store, (state) => state.measurements)
  const requests = useStore(store, (state) => state.requests)
  const notice = useStore(store, (state) => state.notices.sensors)
  const actions = useStore(store, useShallow((state) => ({ requestPermission: state.requestPermission, startLocation: state.startLocation, stopLocation: state.stopLocation, readLocations: state.readLocations, scan: state.scanHeartRate, stopScan: state.stopHeartRateScan, connect: state.connectHeartRate, disconnect: state.disconnectHeartRate, readHeartRate: state.readHeartRate })))
  const capabilities = bridge.capabilities
  const locationSupported = ['location.status', 'location.start', 'location.stop', 'location.read'].every((capability) => capabilities.includes(capability as Capability))
  const heartRateSupported = ['heartRate.status', 'heartRate.scan', 'heartRate.stopScan', 'heartRate.connect', 'heartRate.disconnect', 'heartRate.read'].every((capability) => capabilities.includes(capability as Capability))
  const permissionRequestsSupported = capabilities.includes('permissions.request')
  const busy = pending(requests)
  const latestLocation = locations.at(-1) ?? location?.latestObservation
  const latestHeartRate = measurements.at(-1) ?? heartRate?.latestMeasurement
  const locationAuthorized = permissions?.location.details.authorization === 'whenInUse' || permissions?.location.details.authorization === 'always'
  const canStartLocation = location?.availability === 'available' && locationAuthorized && (location.state === 'inactive' || location.state === 'error')
  const bluetoothReady = heartRate?.availability === 'available' && permissions?.bluetooth.details.authorization === 'allowed' && permissions.bluetooth.details.power === 'poweredOn'
  const evidence = bridge.transport === 'simulator' ? 'Simulated fixture evidence' : bridge.phase === 'ready' ? 'Real native device data' : 'Native bridge not verified'
  return <section className="sensor-harness">
    <div className="harness-heading"><div><p className="eyebrow">EXPLICIT DEVICE PROBES</p><h2>Sensor API harness</h2></div><Pill tone={evidence.startsWith('Real') ? 'good' : 'warning'}>{evidence}</Pill></div>
    <p className="harness-warning">Status reads are passive. Buttons labelled Request, Start, Scan, Connect, Stop, or Disconnect intentionally change native sensor state.</p>
    <article className="probe-card">
      <div className="probe-title"><MapPin /><div><strong>Core Location</strong><small>{locationSupported ? location?.reason ?? 'Reading status…' : 'This native shell did not advertise the location probe API.'}</small></div><Pill tone={location?.state === 'active' ? 'good' : 'neutral'}>{locationSupported ? location?.state ?? 'loading' : 'unavailable'}</Pill></div>
      <dl className="evidence-grid"><div><dt>Permission</dt><dd>{permissions?.location.details.authorization ?? '—'}</dd></div><div><dt>Lifecycle</dt><dd>{location?.appLifecycle ?? '—'}</dd></div><div><dt>Received / accepted</dt><dd>{location ? `${location.receivedCount} / ${location.acceptedCount}` : '—'}</dd></div><div><dt>Rejected</dt><dd>{location?.rejectedCount ?? '—'}{location?.lastRejectionReason ? ` · ${location.lastRejectionReason}` : ''}</dd></div><div><dt>Background delivery</dt><dd>{location?.backgroundDeliveryActive ? 'active' : 'not active'}</dd></div></dl>
      {latestLocation && <div className="raw-evidence"><strong>Latest #{latestLocation.cursor}</strong><code>{latestLocation.latitudeDegrees.toFixed(6)}, {latestLocation.longitudeDegrees.toFixed(6)}</code><small>±{latestLocation.horizontalAccuracyM.toFixed(1)} m · speed {latestLocation.speedMps?.toFixed(2) ?? '—'} m/s · source {latestLocation.source} · simulated {String(latestLocation.isSimulatedBySoftware)}</small><small>{latestLocation.sourceTimestamp}</small></div>}
      {locationSupported && <div className="probe-actions">{permissionRequestsSupported && <Button onClick={() => void actions.requestPermission('locationWhenInUse')} disabled={busy}>Request location permission</Button>}{location?.state === 'active' ? <Button variant="danger" onClick={() => void actions.stopLocation()} disabled={busy}>Stop location</Button> : <><Button variant="primary" onClick={() => void actions.startLocation('foregroundOnly')} disabled={busy || !canStartLocation}>Start 2 min foreground</Button><Button onClick={() => void actions.startLocation('continueWhenBackgrounded')} disabled={busy || !canStartLocation}>Start 2 min background test</Button></>}<Button onClick={() => void actions.readLocations()} disabled={busy || !location?.probeId}>Read retained locations</Button></div>}
    </article>
    <article className="probe-card">
      <div className="probe-title"><HeartPulse /><div><strong>Bluetooth heart rate</strong><small>{heartRateSupported ? heartRate?.reason ?? 'Reading status…' : 'This native shell did not advertise the heart-rate probe API.'}</small></div><Pill tone={heartRate?.state === 'connected' ? 'good' : 'neutral'}>{heartRateSupported ? heartRate?.state ?? 'loading' : 'unavailable'}</Pill></div>
      <dl className="evidence-grid"><div><dt>Permission / power</dt><dd>{permissions ? `${permissions.bluetooth.details.authorization} / ${permissions.bluetooth.details.power}` : '—'}</dd></div><div><dt>Lifecycle</dt><dd>{heartRate?.appLifecycle ?? '—'}</dd></div><div><dt>Devices</dt><dd>{heartRate?.devices.length ?? '—'}</dd></div><div><dt>Received / parse errors</dt><dd>{heartRate ? `${heartRate.receivedCount} / ${heartRate.parseErrorCount}` : '—'}</dd></div><div><dt>Reconnects</dt><dd>{heartRate?.reconnectCount ?? '—'}</dd></div></dl>
      {latestHeartRate && <div className="raw-evidence"><strong>Latest #{latestHeartRate.cursor}</strong><code>{latestHeartRate.bpm} bpm</code><small>contact {latestHeartRate.sensorContact} · {latestHeartRate.valueFormat} · flags 0x{latestHeartRate.rawFlags.toString(16).padStart(2, '0')}</small><small>{latestHeartRate.receivedAt}</small></div>}
      {heartRate?.devices.map((device) => <div className="device-row" key={device.deviceId}><div><strong>{device.name ?? 'Unnamed HR monitor'}</strong><small>{device.deviceId} · RSSI {device.rssi ?? '—'} · seen {age(device.lastSeenAt)}</small></div><Button onClick={() => void actions.connect(device.deviceId)} disabled={busy || !bluetoothReady || device.isConnectable === false || heartRate.state === 'connected'}>Connect</Button></div>)}
      {heartRateSupported && <div className="probe-actions">{permissionRequestsSupported && <Button onClick={() => void actions.requestPermission('bluetooth')} disabled={busy}>Request Bluetooth permission</Button>}{heartRate?.state === 'scanning' ? <Button variant="danger" onClick={() => void actions.stopScan()} disabled={busy}>Stop scan</Button> : <Button variant="primary" onClick={() => void actions.scan()} disabled={busy || !bluetoothReady || heartRate?.state === 'connected'}>Scan 10 seconds</Button>}<Button variant="danger" onClick={() => void actions.disconnect()} disabled={busy || !heartRate?.connectionId}>Disconnect</Button><Button onClick={() => void actions.readHeartRate()} disabled={busy || !heartRate?.connectionId}>Read retained HR</Button></div>}
    </article>
    {notice && <p className="notice" role="status">{notice}</p>}
  </section>
}

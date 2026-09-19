import { Activity, ArrowLeft, CheckCircle2, ChevronRight, CircleAlert, Download, Gauge, HeartPulse, MapPin, RefreshCw, RotateCcw, Settings as SettingsIcon, Share2, ShieldCheck, Smartphone, Wifi } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppBuildStatus, Capability, CommandResults, DiagnosticCheckResult, DiagnosticSnapshot, HeartRateMeasurement, HeartRateStatus, LocationObservation, LocationProbeStatus, NativeEvent, PermissionStatus, StatusRow } from '../../src/shared/mobile'
import type { BridgeClient, BridgeState } from './bridge/client'
import { Button } from './components/Button'

type Screen = 'home' | 'settings' | 'diagnostics'

const age = (value: string | null) => {
  if (!value) return 'Never observed'
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`
}

const StatusIcon = ({ status }: { status: StatusRow['status'] }) => status === 'ok' ? <CheckCircle2 /> : <CircleAlert />

const TopBar = ({ title, back, action }: { title: string; back?: () => void; action?: React.ReactNode }) => <header className="topbar">
  <div>{back && <button className="icon-button" onClick={back} aria-label="Back"><ArrowLeft /></button>}</div>
  <strong>{title}</strong><div>{action}</div>
</header>

const Pill = ({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) => <span className={`pill pill-${tone}`}>{children}</span>

export const App = ({ client }: { client: BridgeClient }) => {
  const [screen, setScreen] = useState<Screen>('diagnostics')
  const [bridge, setBridge] = useState<BridgeState>(client.getState())
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null)
  const [builds, setBuilds] = useState<AppBuildStatus | null>(null)

  const refreshOverview = useCallback(async () => {
    const [nextPermissions, nextBuilds] = await Promise.all([client.request('permissions.status', {}), client.request('appBuild.status', {})])
    setPermissions(nextPermissions); setBuilds(nextBuilds)
  }, [client])

  useEffect(() => client.subscribe(setBridge), [client])
  useEffect(() => { void client.connect().then(refreshOverview).catch(() => undefined) }, [client, refreshOverview])
  useEffect(() => client.subscribeEvents((event: NativeEvent) => { if (event.type === 'appBuild.updated') setBuilds(event.payload as AppBuildStatus) }), [client])

  if (screen === 'settings') return <Settings client={client} bridge={bridge} builds={builds} refresh={refreshOverview} onBack={() => setScreen('diagnostics')} onDiagnostics={() => setScreen('diagnostics')} />
  if (screen === 'diagnostics') return <Diagnostics client={client} bridge={bridge} onUtilities={() => setScreen('settings')} />

  return <main className="app-shell home-screen">
    <TopBar title="Workout Analyze" action={<button className="icon-button" onClick={() => setScreen('settings')} aria-label="Settings"><SettingsIcon /></button>} />
    <section className="hero">
      <Pill tone={bridge.transport === 'simulator' ? 'warning' : 'good'}><Smartphone /> {bridge.transportLabel}</Pill>
      <p className="eyebrow">READY FOR THE ROAD AHEAD</p>
      <h1>Your ride,<br /><em>when recording arrives.</em></h1>
      <p>Phase 1 verifies the native shell, update path, and diagnostics without starting sensors or asking for permission.</p>
    </section>
    <section className="status-grid">
      <article className="metric-card"><MapPin /><span>Location</span><strong>{permissions?.location.status === 'ok' ? 'Ready' : 'Not started'}</strong><small>{permissions?.location.reason ?? 'Reading native status…'}</small></article>
      <article className="metric-card"><HeartPulse /><span>Heart rate</span><strong>Unavailable</strong><small>{permissions?.bluetooth.reason ?? 'Reading native status…'}</small></article>
    </section>
    <section className="card recent-card"><div><p className="eyebrow">SHELL STATUS</p><h2>{bridge.phase === 'ready' ? 'Native connection ready' : bridge.phase === 'error' ? 'Connection needs attention' : 'Connecting…'}</h2><p>{bridge.error ?? `Build ${builds?.active.buildId ?? '…'} · Engine ${builds?.active.engineBuildId ?? '…'}`}</p></div><Gauge /></section>
    <div className="home-bottom">
      <Button variant="primary" disabled><Activity /> Recording unavailable in Phase 1</Button>
      <p><ShieldCheck /> No sensor, permission, or workout changes occur from this screen.</p>
    </div>
  </main>
}

const Settings = ({ client, bridge, builds, refresh, onBack, onDiagnostics }: { client: BridgeClient; bridge: BridgeState; builds: AppBuildStatus | null; refresh: () => Promise<void>; onBack: () => void; onDiagnostics: () => void }) => {
  const [devUrl, setDevUrl] = useState('http://192.168.1.20:3001/')
  const [manifestUrl, setManifestUrl] = useState('https://example.com/workout-analyze/manifest.json')
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const act = async (work: () => Promise<unknown>, success: string) => { setBusy(true); setNotice(null); try { await work(); setNotice(success); await refresh() } catch (error) { setNotice(error instanceof Error ? error.message : 'Request failed') } finally { setBusy(false) } }
  const reload = () => act(() => client.request('ui.reload', {}), 'Native accepted the UI reload request.')
  return <main className="app-shell">
    <TopBar title="Settings" back={onBack} />
    <section className="page-heading"><p className="eyebrow">SHELL & DELIVERY</p><h1>App source</h1><p>Switch web code without reinstalling the native shell. Engine changes take effect for the next session.</p></section>
    <section className="card build-card"><div className="card-title"><Wifi /><div><span>Current source</span><strong>{builds?.active.source ?? 'Loading…'}</strong></div><Pill tone="good">{bridge.phase}</Pill></div><dl><div><dt>Web build</dt><dd>{builds?.active.buildId ?? '—'}</dd></div><div><dt>Engine</dt><dd>{builds?.active.engineBuildId ?? '—'}</dd></div><div><dt>Protocol</dt><dd>v1</dd></div></dl>{builds?.lastFailure && <p className="error-note">{builds.lastFailure}</p>}</section>
    <section className="form-section"><label htmlFor="dev-url">Development server URL</label><div className="input-row"><input id="dev-url" value={devUrl} onChange={(event) => setDevUrl(event.target.value)} inputMode="url" autoCapitalize="none" /><Button disabled={busy} onClick={() => act(async () => { await client.request('devSource.configure', { url: devUrl }); await client.request('ui.reload', {}) }, 'Development source configured; reload accepted.')}><Wifi /> Connect</Button></div><small>HTTP is accepted only for the explicitly selected development host.</small></section>
    <section className="form-section"><label htmlFor="manifest-url">HTTPS build manifest</label><input id="manifest-url" value={manifestUrl} onChange={(event) => setManifestUrl(event.target.value)} inputMode="url" autoCapitalize="none" /><Button className="full" disabled={busy} onClick={() => act(async () => { const result = await client.request('appBuild.download', { manifestUrl }); await client.request('appBuild.activate', { buildId: result.build.buildId }); await client.request('ui.reload', {}) }, 'Build verified, activated, and reload accepted.')}><Download /> Download, activate & reload</Button></section>
    <section className="action-list">
      <button onClick={reload} disabled={busy}><RefreshCw /><span><strong>Reload current UI</strong><small>Reconnects to native session state</small></span><ChevronRight /></button>
      <button onClick={() => act(async () => { await client.request('appBuild.rollback', { target: 'previous' }); await client.request('ui.reload', {}) }, 'Previous build restored; reload accepted.')} disabled={busy || !builds?.previous}><RotateCcw /><span><strong>Use previous build</strong><small>{builds?.previous?.buildId ?? 'No previous build available'}</small></span><ChevronRight /></button>
      <button onClick={() => act(async () => { await client.request('appBuild.rollback', { target: 'bundled' }); await client.request('ui.reload', {}) }, 'Bundled build restored; reload accepted.')} disabled={busy}><ShieldCheck /><span><strong>Use bundled build</strong><small>{builds?.bundled.buildId ?? 'Known-good fallback'}</small></span><ChevronRight /></button>
      <button onClick={onDiagnostics}><Gauge /><span><strong>Diagnostics</strong><small>Native health, checks, and export</small></span><ChevronRight /></button>
    </section>
    {notice && <p className="notice" role="status">{notice}</p>}
  </main>
}

const Diagnostics = ({ client, bridge, onUtilities }: { client: BridgeClient; bridge: BridgeState; onUtilities: () => void }) => {
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot | null>(null)
  const [checks, setChecks] = useState<readonly DiagnosticCheckResult[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const refresh = useCallback(() => client.request('diagnostics.snapshot', {}).then(setSnapshot).catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'Refresh failed')), [client])
  useEffect(() => {
    if (bridge.phase !== 'ready') return
    void refresh()
    const onVisibility = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisibility)
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 10_000)
    return () => { document.removeEventListener('visibilitychange', onVisibility); window.clearInterval(timer) }
  }, [bridge.phase, refresh])
  const run = async () => { setBusy(true); setNotice(null); try { const result = await client.request('diagnostics.runChecks', { checks: null }); setChecks(result.results); setNotice(result.workoutStateUnchanged ? 'Checks finished. Workout state was unchanged.' : null) } catch (error) { setNotice(error instanceof Error ? error.message : 'Checks failed') } finally { setBusy(false) } }
  const exportReport = async () => { setBusy(true); try { const result = await client.request('diagnostics.export', { includeWorkoutObservations: false }); setNotice(result.presented ? `Native share sheet opened · ${result.exportId}` : 'Native export was prepared but not presented.') } catch (error) { setNotice(error instanceof Error ? error.message : 'Export failed') } finally { setBusy(false) } }
  return <main className="app-shell diagnostics-screen">
    <TopBar title="Diagnostics" action={<button className="icon-button" onClick={onUtilities} aria-label="Build and source utilities"><SettingsIcon /></button>} />
    <section className="page-heading"><Pill tone={bridge.transport === 'simulator' ? 'warning' : 'good'}>{bridge.transportLabel}</Pill><h1>Native health</h1><p>Read-only observations. This page never starts sensors, prompts for permission, or mutates a workout.</p><Button className="utility-link" onClick={onUtilities}><SettingsIcon /> Build & source utilities</Button></section>
    <section className="summary-strip"><div><strong>{snapshot?.rows.filter((item) => item.status === 'ok').length ?? '—'}</strong><span>OK</span></div><div><strong>{snapshot?.rows.filter((item) => item.status === 'waiting').length ?? '—'}</strong><span>WAITING</span></div><div><strong>{snapshot?.rows.filter((item) => ['error', 'unavailable'].includes(item.status)).length ?? '—'}</strong><span>ATTENTION</span></div></section>
    {bridge.error && <p className="notice notice-error" role="alert">Native bridge: {bridge.error}</p>}
    <SensorHarness client={client} ready={bridge.phase === 'ready'} capabilities={bridge.capabilities} initialSnapshot={bridge.snapshot} evidence={bridge.transport === 'simulator' ? 'Simulated fixture evidence' : bridge.phase === 'ready' ? 'Real native device data' : 'Native bridge not verified'} />
    <section className="diagnostic-list">{snapshot?.rows.map((item) => <article key={item.id} className={`diagnostic-row status-${item.status}`}><StatusIcon status={item.status} /><div><div className="row-title"><strong>{item.label}</strong><Pill tone={item.status}>{item.status}</Pill></div><p>{item.reason}</p><small>{item.freshness} · {age(item.observedAt)}</small></div></article>) ?? <p>Reading native snapshot…</p>}</section>
    {checks.length > 0 && <section className="checks"><p className="eyebrow">LAST CHECK RUN</p>{checks.map((check) => <div key={check.id}><CheckCircle2 /><span><strong>{check.id}</strong><small>{check.reason}</small></span><Pill tone={check.outcome === 'pass' ? 'good' : 'error'}>{check.outcome}</Pill></div>)}</section>}
    <div className="sticky-actions"><Button variant="primary" onClick={run} disabled={busy || bridge.phase !== 'ready'}><ShieldCheck /> Run isolated checks</Button><Button onClick={exportReport} disabled={busy || bridge.phase !== 'ready'}><Share2 /> Export diagnostics</Button><small>Export excludes workout observations by default.</small></div>
    {notice && <p className="notice" role="status">{notice}</p>}
  </main>
}

const SensorHarness = ({ client, ready, capabilities, initialSnapshot, evidence }: { client: BridgeClient; ready: boolean; capabilities: readonly Capability[]; initialSnapshot: CommandResults['bridge.snapshot'] | null; evidence: string }) => {
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null)
  const [location, setLocation] = useState<LocationProbeStatus | null>(null)
  const [heartRate, setHeartRate] = useState<HeartRateStatus | null>(null)
  const [locations, setLocations] = useState<readonly LocationObservation[]>([])
  const [measurements, setMeasurements] = useState<readonly HeartRateMeasurement[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const locationRef = useRef<LocationProbeStatus | null>(null)
  const heartRateRef = useRef<HeartRateStatus | null>(null)
  const locationSupported = ['location.status', 'location.start', 'location.stop', 'location.read'].every((capability) => capabilities.includes(capability as Capability))
  const heartRateSupported = ['heartRate.status', 'heartRate.scan', 'heartRate.stopScan', 'heartRate.connect', 'heartRate.disconnect', 'heartRate.read'].every((capability) => capabilities.includes(capability as Capability))
  const permissionRequestsSupported = capabilities.includes('permissions.request')
  const refresh = useCallback(async () => {
    if (!ready) return
    const nextPermissions = await client.request('permissions.status', {})
    setPermissions(nextPermissions)
    if (locationSupported) setLocation(await client.request('location.status', {}))
    if (heartRateSupported) setHeartRate(await client.request('heartRate.status', {}))
  }, [client, heartRateSupported, locationSupported, ready])
  useEffect(() => {
    if (!initialSnapshot) return
    setPermissions(initialSnapshot.permissions); setLocation(initialSnapshot.location); setHeartRate(initialSnapshot.heartRate)
  }, [initialSnapshot])
  useEffect(() => { locationRef.current = location }, [location])
  useEffect(() => { heartRateRef.current = heartRate }, [heartRate])
  useEffect(() => {
    void refresh().catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'Sensor status failed'))
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 5_000)
    return () => window.clearInterval(timer)
  }, [refresh])
  useEffect(() => client.subscribeEvents((event) => {
    if (event.type === 'permissions.updated') setPermissions(event.payload as PermissionStatus)
    if (event.type === 'location.updated') setLocation(event.payload as LocationProbeStatus)
    if (event.type === 'heartRate.updated') setHeartRate(event.payload as HeartRateStatus)
  }), [client])
  useEffect(() => () => {
    const currentLocation = locationRef.current
    if (currentLocation?.probeId && ['starting', 'active'].includes(currentLocation.state)) void client.request('location.stop', { probeId: currentLocation.probeId }).catch(() => undefined)
    if (heartRateRef.current?.state === 'scanning') void client.request('heartRate.stopScan', {}).catch(() => undefined)
  }, [client])
  const act = async (name: string, operation: () => Promise<void>) => { setBusy(name); setNotice(null); try { await operation(); await refresh() } catch (error) { setNotice(error instanceof Error ? error.message : `${name} failed`) } finally { setBusy(null) } }
  const requestPermission = (permission: 'locationWhenInUse' | 'bluetooth') => act(permission, async () => { setPermissions(await client.request('permissions.request', { permission })) })
  const startLocation = (backgroundMode: 'foregroundOnly' | 'continueWhenBackgrounded') => act(`location-${backgroundMode}`, async () => { setLocation(await client.request('location.start', { desiredAccuracy: 'best', distanceFilterM: 0, backgroundMode, maxDurationSeconds: 120 })) })
  const stopLocation = () => location?.probeId ? act('location-stop', async () => { setLocation(await client.request('location.stop', { probeId: location.probeId! })) }) : Promise.resolve()
  const readLocations = () => location?.probeId ? act('location-read', async () => { const page = await client.request('location.read', { probeId: location.probeId!, afterCursor: null, limit: 50 }); setLocations(page.items); setNotice(`Read ${page.items.length} retained location observations${page.droppedBeforeCursor ? '; older data was dropped' : ''}.`) }) : Promise.resolve()
  const scan = () => act('hr-scan', async () => { setHeartRate(await client.request('heartRate.scan', { durationSeconds: 10 })) })
  const stopScan = () => act('hr-stop-scan', async () => { setHeartRate(await client.request('heartRate.stopScan', {})) })
  const connect = (deviceId: string) => act(`hr-connect-${deviceId}`, async () => { setHeartRate(await client.request('heartRate.connect', { deviceId })) })
  const disconnect = () => heartRate?.connectionId ? act('hr-disconnect', async () => { setHeartRate(await client.request('heartRate.disconnect', { connectionId: heartRate.connectionId! })) }) : Promise.resolve()
  const readHeartRate = () => heartRate?.connectionId ? act('hr-read', async () => { const page = await client.request('heartRate.read', { connectionId: heartRate.connectionId!, afterCursor: null, limit: 50 }); setMeasurements(page.items); setNotice(`Read ${page.items.length} retained heart-rate measurements${page.droppedBeforeCursor ? '; older data was dropped' : ''}.`) }) : Promise.resolve()
  const latestLocation = locations.at(-1) ?? location?.latestObservation
  const latestHeartRate = measurements.at(-1) ?? heartRate?.latestMeasurement
  const locationAuthorized = permissions?.location.details.authorization === 'whenInUse' || permissions?.location.details.authorization === 'always'
  const canStartLocation = location?.availability === 'available' && locationAuthorized && (location.state === 'inactive' || location.state === 'error')
  const bluetoothReady = heartRate?.availability === 'available' && permissions?.bluetooth.details.authorization === 'allowed' && permissions.bluetooth.details.power === 'poweredOn'
  return <section className="sensor-harness">
    <div className="harness-heading"><div><p className="eyebrow">EXPLICIT DEVICE PROBES</p><h2>Sensor API harness</h2></div><Pill tone={evidence.startsWith('Real') ? 'good' : 'warning'}>{evidence}</Pill></div>
    <p className="harness-warning">Status reads are passive. Buttons labelled Request, Start, Scan, Connect, Stop, or Disconnect intentionally change native sensor state.</p>
    <article className="probe-card">
      <div className="probe-title"><MapPin /><div><strong>Core Location</strong><small>{locationSupported ? location?.reason ?? 'Reading status…' : 'This native shell did not advertise the location probe API.'}</small></div><Pill tone={location?.state === 'active' ? 'good' : 'neutral'}>{locationSupported ? location?.state ?? 'loading' : 'unavailable'}</Pill></div>
      <dl className="evidence-grid"><div><dt>Permission</dt><dd>{permissions?.location.details.authorization ?? '—'}</dd></div><div><dt>Lifecycle</dt><dd>{location?.appLifecycle ?? '—'}</dd></div><div><dt>Received / accepted</dt><dd>{location ? `${location.receivedCount} / ${location.acceptedCount}` : '—'}</dd></div><div><dt>Rejected</dt><dd>{location?.rejectedCount ?? '—'}{location?.lastRejectionReason ? ` · ${location.lastRejectionReason}` : ''}</dd></div><div><dt>Background delivery</dt><dd>{location?.backgroundDeliveryActive ? 'active' : 'not active'}</dd></div></dl>
      {latestLocation && <div className="raw-evidence"><strong>Latest #{latestLocation.cursor}</strong><code>{latestLocation.latitudeDegrees.toFixed(6)}, {latestLocation.longitudeDegrees.toFixed(6)}</code><small>±{latestLocation.horizontalAccuracyM.toFixed(1)} m · speed {latestLocation.speedMps?.toFixed(2) ?? '—'} m/s · source {latestLocation.source} · simulated {String(latestLocation.isSimulatedBySoftware)}</small><small>{latestLocation.sourceTimestamp}</small></div>}
      {locationSupported && <div className="probe-actions">{permissionRequestsSupported && <Button onClick={() => void requestPermission('locationWhenInUse')} disabled={busy !== null}>Request location permission</Button>}{location?.state === 'active' ? <Button variant="danger" onClick={() => void stopLocation()} disabled={busy !== null}>Stop location</Button> : <><Button variant="primary" onClick={() => void startLocation('foregroundOnly')} disabled={busy !== null || !canStartLocation}>Start 2 min foreground</Button><Button onClick={() => void startLocation('continueWhenBackgrounded')} disabled={busy !== null || !canStartLocation}>Start 2 min background test</Button></>}<Button onClick={() => void readLocations()} disabled={busy !== null || !location?.probeId}>Read retained locations</Button></div>}
    </article>
    <article className="probe-card">
      <div className="probe-title"><HeartPulse /><div><strong>Bluetooth heart rate</strong><small>{heartRateSupported ? heartRate?.reason ?? 'Reading status…' : 'This native shell did not advertise the heart-rate probe API.'}</small></div><Pill tone={heartRate?.state === 'connected' ? 'good' : 'neutral'}>{heartRateSupported ? heartRate?.state ?? 'loading' : 'unavailable'}</Pill></div>
      <dl className="evidence-grid"><div><dt>Permission / power</dt><dd>{permissions ? `${permissions.bluetooth.details.authorization} / ${permissions.bluetooth.details.power}` : '—'}</dd></div><div><dt>Lifecycle</dt><dd>{heartRate?.appLifecycle ?? '—'}</dd></div><div><dt>Devices</dt><dd>{heartRate?.devices.length ?? '—'}</dd></div><div><dt>Received / parse errors</dt><dd>{heartRate ? `${heartRate.receivedCount} / ${heartRate.parseErrorCount}` : '—'}</dd></div><div><dt>Reconnects</dt><dd>{heartRate?.reconnectCount ?? '—'}</dd></div></dl>
      {latestHeartRate && <div className="raw-evidence"><strong>Latest #{latestHeartRate.cursor}</strong><code>{latestHeartRate.bpm} bpm</code><small>contact {latestHeartRate.sensorContact} · {latestHeartRate.valueFormat} · flags 0x{latestHeartRate.rawFlags.toString(16).padStart(2, '0')}</small><small>{latestHeartRate.receivedAt}</small></div>}
      {heartRate?.devices.map((device) => <div className="device-row" key={device.deviceId}><div><strong>{device.name ?? 'Unnamed HR monitor'}</strong><small>{device.deviceId} · RSSI {device.rssi ?? '—'} · seen {age(device.lastSeenAt)}</small></div><Button onClick={() => void connect(device.deviceId)} disabled={busy !== null || !bluetoothReady || device.isConnectable === false || heartRate.state === 'connected'}>Connect</Button></div>)}
      {heartRateSupported && <div className="probe-actions">{permissionRequestsSupported && <Button onClick={() => void requestPermission('bluetooth')} disabled={busy !== null}>Request Bluetooth permission</Button>}{heartRate?.state === 'scanning' ? <Button variant="danger" onClick={() => void stopScan()} disabled={busy !== null}>Stop scan</Button> : <Button variant="primary" onClick={() => void scan()} disabled={busy !== null || !bluetoothReady || heartRate?.state === 'connected'}>Scan 10 seconds</Button>}<Button variant="danger" onClick={() => void disconnect()} disabled={busy !== null || !heartRate?.connectionId}>Disconnect</Button><Button onClick={() => void readHeartRate()} disabled={busy !== null || !heartRate?.connectionId}>Read retained HR</Button></div>}
    </article>
    {notice && <p className="notice" role="status">{notice}</p>}
  </section>
}

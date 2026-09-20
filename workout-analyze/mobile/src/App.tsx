import { Activity, ArrowLeft, Bike, CheckCircle2, ChevronRight, CircleAlert, Download, Gauge, HeartPulse, MapPin, Pause, Play, RefreshCw, RotateCcw, Settings as SettingsIcon, Share2, ShieldCheck, Wifi, FastForward } from 'lucide-react'
import { useState } from 'react'
import { useStore } from 'zustand'
import type { AvailableSessionSnapshot, Capability, RecorderLocationObservation, StatusRow } from '../../src/shared/mobile'
import type { MobileStore, Screen } from './store'
import { isAvailableSession } from './store'
import { Button } from './components/Button'
import { defaultManifestUrl, recommendedDevelopmentUrl } from './config'

const age = (value: string | null) => {
  if (!value) return 'Never'
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`
}
const duration = (milliseconds: number) => {
  const seconds = Math.floor(milliseconds / 1000)
  const hours = Math.floor(seconds / 3600)
  return `${hours ? `${hours}:` : ''}${String(Math.floor(seconds / 60) % 60).padStart(hours ? 2 : 1, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
const distance = (meters: number) => meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`
const speed = (metersPerSecond: number | null) => metersPerSecond === null ? '—' : (metersPerSecond * 3.6).toFixed(1)
const pending = (requests: Readonly<Record<string, { status: string }>>, prefix?: string) => Object.entries(requests).some(([key, value]) => value.status === 'pending' && (!prefix || key.startsWith(prefix)))
const Pill = ({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) => <span className={`pill pill-${tone}`}>{children}</span>
const TopBar = ({ title, back, action }: { title: string; back?: () => void; action?: React.ReactNode }) => <header className="topbar"><div>{back && <button className="icon-button" onClick={back} aria-label="Back"><ArrowLeft /></button>}</div><strong>{title}</strong><div>{action}</div></header>
const UtilityButtons = ({ store }: { store: MobileStore }) => {
  const setScreen = useStore(store, (state) => state.setScreen)
  return <div className="utility-buttons"><button onClick={() => setScreen('heartRate')}><HeartPulse /> Heart rate</button><button onClick={() => setScreen('diagnostics')}><Gauge /> Diagnostics</button><button onClick={() => setScreen('settings')}><SettingsIcon /> Source</button></div>
}

export const App = ({ store }: { store: MobileStore }) => {
  const screen = useStore(store, (state) => state.screen)
  const screens: Record<Screen, React.ReactNode> = {
    home: <Home store={store} />, live: <Live store={store} />, paused: <Paused store={store} />, recovery: <Recovery store={store} />,
    saved: <Saved store={store} />, history: <History store={store} />, savedDetail: <SavedDetail store={store} />, heartRate: <HeartRate store={store} />, settings: <Settings store={store} />, diagnostics: <Diagnostics store={store} />, replay: <Replay store={store} />,
  }
  return screens[screen]
}

const Home = ({ store }: { store: MobileStore }) => {
  const bridge = useStore(store, (state) => state.bridge)
  const recorderSupported = useStore(store, (state) => state.recorderSupported)
  const permissions = useStore(store, (state) => state.permissions)
  const heartRate = useStore(store, (state) => state.heartRate)
  const session = useStore(store, (state) => state.session)
  const requests = useStore(store, (state) => state.requests)
  const notice = useStore(store, (state) => state.notices.recording)
  const startWorkout = useStore(store, (state) => state.startWorkout)
  const requestPermission = useStore(store, (state) => state.requestPermission)
  const setScreen = useStore(store, (state) => state.setScreen)
  const savedWorkouts = useStore(store, (state) => state.savedWorkouts)
  const loadReplay = useStore(store, (state) => state.loadLocalReplay)
  const locationAuth = permissions?.location.details.authorization
  const needsPermission = locationAuth === 'notDetermined'
  const denied = locationAuth === 'denied' || locationAuth === 'restricted'
  const active = isAvailableSession(session) && ['recording', 'paused', 'interrupted'].includes(session.state)
  const busy = pending(requests, 'workout-') || pending(requests, 'permission-location')
  return <main className="app-shell home-screen">
    <TopBar title="Workout Ledger" />
    <section className="home-hero"><Pill tone={bridge.phase === 'ready' ? 'good' : 'warning'}>{bridge.transportLabel}</Pill><h1>Ready to<br /><em>ride.</em></h1><p>GPS recording works without a heart-rate monitor or route catalog.</p></section>
    <section className="home-status"><article><MapPin /><div><span>GPS</span><strong>{denied ? 'Permission blocked' : permissions?.location.reason ?? 'Connecting…'}</strong></div></article><article><HeartPulse /><div><span>Heart rate · optional</span><strong>{heartRate?.connectedDevice?.name ?? heartRate?.reason ?? 'Not connected'}</strong></div></article></section>
    {!recorderSupported && bridge.phase === 'ready' && <p className="notice notice-error">This installed native shell does not provide the frozen recorder capabilities. Update the shell to record; diagnostics and source utilities remain available.</p>}
    {notice && <p className="notice notice-error" role="alert">{notice}</p>}
    {bridge.capabilities.includes('archive.list') && <button className="recent-workout" onClick={() => setScreen('history')}><Activity /><span><strong>Saved workouts</strong><small>{savedWorkouts.length ? `${savedWorkouts.length} available on this device` : 'No completed rides yet'}</small></span><ChevronRight /></button>}
    <UtilityButtons store={store} />
    {import.meta.env.DEV && <Button className="full replay-entry" onClick={() => void loadReplay()}><FastForward /> Load immutable local replay</Button>}
    <div className="home-bottom">
      {active ? <Button variant="primary" disabled={busy} onClick={() => setScreen(session!.state === 'recording' ? 'live' : session!.state === 'paused' ? 'paused' : 'recovery')}><Bike /> Return to ride</Button>
        : needsPermission ? <Button variant="primary" disabled={busy || !recorderSupported} onClick={() => void requestPermission('locationWhenInUse')}><MapPin /> Allow location to start</Button>
          : <Button variant="primary" disabled={busy || !recorderSupported || denied} onClick={() => void startWorkout('waitForReliableLocation')}><Bike /> Start ride</Button>}
      <p><ShieldCheck /> Starts immediately and waits for reliable GPS. Native recording continues if this UI reloads.</p>
    </div>
  </main>
}

const Replay = ({ store }: { store: MobileStore }) => {
  const replay = useStore(store, (state) => state.replay)
  const session = useStore(store, (state) => state.session)
  const trail = useStore(store, (state) => state.trail)
  const play = useStore(store, (state) => state.playReplay)
  const pause = useStore(store, (state) => state.pauseReplay)
  const speedAction = useStore(store, (state) => state.setReplaySpeed)
  const seek = useStore(store, (state) => state.seekReplay)
  const close = useStore(store, (state) => state.closeReplay)
  const metrics = isAvailableSession(session) ? session.metrics : null
  return <main className="app-shell ride-screen replay-screen"><TopBar title="Ride replay" back={close} />
    <section className="replay-banner"><FastForward /><div><strong>IMMUTABLE LOCAL REPLAY</strong><small>Isolated namespace · cannot export or mutate the source workout</small></div></section>
    {replay.error && <p className="notice notice-error">{replay.error}</p>}
    {metrics ? <><section className="durability-grid"><div><span>JOURNAL CURSOR</span><strong>{replay.checkpoint?.throughJournalSequence.toLocaleString() ?? '—'} / {replay.metadata?.lastJournalSequence.toLocaleString() ?? '—'}</strong><small>Raw sequence domain</small></div><div><span>PROJECTED INPUT</span><strong>{replay.checkpoint?.projector.observationSequence.toLocaleString() ?? '—'}</strong><small>Normalized sequence domain</small></div><div><span>UNKNOWN EVENTS</span><strong>{replay.checkpoint?.projector.unknownEventCount ?? 0}</strong><small>Preserved and skipped safely</small></div><div><span>MALFORMED EVENTS</span><strong>{replay.checkpoint?.projector.malformedEventCount ?? 0}</strong><small>Preserved and reported</small></div></section><RideMap trail={trail} quality={metrics.locationQuality} showTiles={false} /><section className="speed-hero"><span>REPLAY SPEED</span><strong>{speed(metrics.currentSpeedMps)}</strong><small>km/h</small></section><section className="ride-metrics"><Metric label="Active" value={duration(metrics.activeDurationMs)} /><Metric label="Distance" value={distance(metrics.distanceM)} /><Metric label="Avg speed" value={metrics.averageSpeedMps === null ? '—' : `${speed(metrics.averageSpeedMps)} km/h`} /><Metric label="Heart rate" value={metrics.heartRateBpm === null ? '—' : `${metrics.heartRateBpm} bpm`} /><Metric label="Ascent · est." value={`${Math.round(metrics.elevationGainM)} m`} /><Metric label="Elapsed" value={duration(metrics.elapsedDurationMs)} /></section></> : <p className="notice">Loading the first replay checkpoint…</p>}
    <section className="replay-controls"><input aria-label="Replay position" type="range" min="0" max={replay.durationMs || 1} value={replay.positionMs} onChange={(event) => void seek(Number(event.target.value))} /><div><Button onClick={replay.status === 'playing' ? pause : play} disabled={replay.status === 'loading' || replay.status === 'error'}>{replay.status === 'playing' ? <><Pause /> Pause</> : <><Play /> Play</>}</Button><label>Speed<select value={replay.speed} onChange={(event) => speedAction(Number(event.target.value))}>{[0.5, 1, 2, 4, 8, 16].map((value) => <option key={value} value={value}>{value}×</option>)}</select></label><span>{duration(replay.positionMs)} / {duration(replay.durationMs)}</span></div></section>
  </main>
}

const History = ({ store }: { store: MobileStore }) => {
  const items = useStore(store, (state) => state.savedWorkouts)
  const requests = useStore(store, (state) => state.requests)
  const open = useStore(store, (state) => state.openSavedWorkout)
  const setScreen = useStore(store, (state) => state.setScreen)
  return <main className="app-shell"><TopBar title="Saved workouts" back={() => setScreen('home')} /><section className="page-heading"><h1>On this iPhone</h1><p>Native records, reopened from durable storage—not browser memory.</p></section><section className="history-list">{items.map((item) => <button key={item.savedWorkoutId} onClick={() => void open(item.savedWorkoutId)} disabled={pending(requests, 'archive-detail')}><Bike /><span><strong>{new Date(item.startedAt).toLocaleString()}</strong><small>{distance(item.metrics.distanceM)} · {duration(item.durationMs)} · {item.observationCount.toLocaleString()} normalized recorder events</small></span><ChevronRight /></button>)}{items.length === 0 && <p className="notice">No saved workouts are available yet.</p>}</section></main>
}

const SavedDetail = ({ store }: { store: MobileStore }) => {
  const detail = useStore(store, (state) => state.savedWorkoutDetail)
  const requests = useStore(store, (state) => state.requests)
  const notice = useStore(store, (state) => state.notices.recording)
  const exportSaved = useStore(store, (state) => state.exportSavedWorkout)
  const setScreen = useStore(store, (state) => state.setScreen)
  if (!detail) return <History store={store} />
  const trail = detail.observations.items.filter((item): item is RecorderLocationObservation => item.kind === 'location')
  return <main className="app-shell saved-screen"><TopBar title="Saved ride" back={() => setScreen('history')} /><section className="saved-heading"><CheckCircle2 /><p>DURABLE NATIVE RECORD</p><h1>{distance(detail.summary.metrics.distanceM)}</h1><span>{duration(detail.summary.durationMs)} · {detail.summary.observationCount.toLocaleString()} normalized recorder events</span></section><RideMap trail={trail} quality={detail.summary.metrics.locationQuality} /><p className="saved-id">Session {detail.summary.sessionId}<br />Engine {detail.pinnedEngine.buildId}</p>{detail.summary.hasFatalIssue && <p className="notice notice-error">This workout contains a fatal recording issue. Export remains available for diagnosis.</p>}<div className="export-actions"><Button disabled={pending(requests, 'archive-export')} onClick={() => void exportSaved(detail.summary.sessionId, 'gpx')}><Share2 /> Export GPX</Button><Button disabled={pending(requests, 'archive-export')} onClick={() => void exportSaved(detail.summary.sessionId, 'workoutBundleV1')}><Download /> Export complete raw bundle</Button></div>{notice && <p className="notice">{notice}</p>}</main>
}

const RideMap = ({ trail, quality, showTiles = true }: { trail: readonly RecorderLocationObservation[]; quality: AvailableSessionSnapshot['metrics']['locationQuality']; showTiles?: boolean }) => {
  const points = trail.map((item) => ({ lat: item.latitudeDegrees, lon: item.longitudeDegrees }))
  const last = points.at(-1)
  const zoom = 15
  const world = 256 * 2 ** zoom
  const project = ({ lat, lon }: { lat: number; lon: number }) => ({ x: (lon + 180) / 360 * world, y: (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * world })
  const center = last ? project(last) : null
  const tiles = center ? [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => ({ x: Math.floor(center.x / 256) + dx, y: Math.floor(center.y / 256) + dy }))) : []
  const path = center ? points.map((point) => { const value = project(point); return `${value.x - center.x + 160},${value.y - center.y + 110}` }).join(' ') : ''
  return <div className="ride-map" aria-label="Live geographic map and recorded trail">
    {center && showTiles && tiles.map((tile) => <img key={`${tile.x}-${tile.y}`} src={`https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`} alt="" style={{ left: tile.x * 256 - center.x + 160, top: tile.y * 256 - center.y + 110 }} />)}
    <svg viewBox="0 0 320 220" preserveAspectRatio="none" aria-hidden="true">{path && <><polyline className="trail-shadow" points={path} /><polyline className="trail-line" points={path} /></>} {last && <><circle className="rider-ring" cx="160" cy="110" r="13" /><circle className="rider" cx="160" cy="110" r="6" /></>}</svg>
    {!last && <div className="map-empty"><MapPin /><strong>Waiting for reliable GPS</strong><span>The ride is already saved and timing.</span></div>}
    <Pill tone={quality === 'good' ? 'good' : 'warning'}>{quality} GPS</Pill>{showTiles && <small className="attribution">© OpenStreetMap contributors</small>}
  </div>
}

const Live = ({ store }: { store: MobileStore }) => {
  const session = useStore(store, (state) => state.session)
  const trail = useStore(store, (state) => state.trail)
  const issues = useStore(store, (state) => state.recordingIssues)
  const rawJournalSequence = useStore(store, (state) => state.rawJournalSequence)
  const diagnostics = useStore(store, (state) => state.diagnostics)
  const heartRate = useStore(store, (state) => state.heartRate)
  const requests = useStore(store, (state) => state.requests)
  const pause = useStore(store, (state) => state.pauseWorkout)
  const finish = useStore(store, (state) => state.finishWorkout)
  const setScreen = useStore(store, (state) => state.setScreen)
  if (!isAvailableSession(session)) return <Home store={store} />
  const metrics = session.metrics
  const storageIssue = issues.find((item) => item.code === 'storageFailure')
  const engineIssue = issues.find((item) => item.code === 'engineFailure')
  const storage = diagnostics?.rows.find((item) => item.id === 'storage' || item.id === 'recorder')
  return <main className="app-shell ride-screen"><TopBar title="Ride" action={<button className="icon-button" onClick={() => setScreen('heartRate')} aria-label="Heart-rate monitor"><HeartPulse /></button>} />
    <section className="recording-banner"><span className="recording-dot" /><div><strong>RAW RECORDING ACTIVE</strong><small>Native recorder · no time limit · continues while locked</small></div></section>
    {storageIssue && <p className="notice notice-error" role="alert"><strong>RAW STORAGE FAILED.</strong> This ride is not safely persisted: {storageIssue.message}</p>}
    {engineIssue && <p className="notice engine-warning" role="status"><strong>Metrics engine failed.</strong> Raw native capture may still continue: {engineIssue.message}</p>}
    <section className="durability-grid"><div><span>DURABLE RAW JOURNAL EVENTS</span><strong>{rawJournalSequence?.toLocaleString() ?? '—'}</strong><small>{rawJournalSequence === null ? 'Raw journal health unavailable' : 'Delivered inputs, before parsing'}</small></div><div><span>NORMALIZED RECORDER EVENTS</span><strong>{session.observationSequence.toLocaleString()}</strong><small>Separate derived input stream</small></div><div><span>LAST NATIVE STORAGE STATUS</span><strong>{storage?.observedAt ? age(storage.observedAt) : 'Awaiting status'}</strong><small>{storage?.reason ?? 'Reading recorder storage…'}</small></div><div><span>GPS METRICS STATUS</span><strong>{metrics.locationQuality}</strong><small>{trail.at(-1) ? `Latest displayed fix ${age(trail.at(-1)!.receivedAt)}` : 'No accepted display fix yet'}</small></div><div><span>DECODED HEART RATE · OPTIONAL</span><strong>{metrics.heartRateQuality}</strong><small>{heartRate?.connectedDevice?.name ?? 'No monitor required'}</small></div></section>
    <RideMap trail={trail} quality={metrics.locationQuality} />
    <section className="speed-hero"><span>CURRENT SPEED</span><strong>{speed(metrics.currentSpeedMps)}</strong><small>km/h</small></section>
    <section className="ride-metrics"><Metric label="Active" value={duration(metrics.activeDurationMs)} /><Metric label="Distance" value={distance(metrics.distanceM)} /><Metric label="Avg speed" value={metrics.averageSpeedMps === null ? '—' : `${speed(metrics.averageSpeedMps)} km/h`} /><Metric label="Heart rate" value={metrics.heartRateBpm === null ? '—' : `${metrics.heartRateBpm} bpm`} /><Metric label="Ascent · est." value={`${Math.round(metrics.elevationGainM)} m`} /><Metric label="Elapsed" value={duration(metrics.elapsedDurationMs)} /></section>
    <p className="catalog-note">Recording only · route matching and automatic laps are not installed in this milestone.</p>
    <div className="ride-action dual"><Button disabled={pending(requests, 'workout-')} onClick={() => void pause()}><Pause /> Pause</Button><Button variant="primary" disabled={pending(requests, 'workout-')} onClick={() => void finish()}><CheckCircle2 /> Stop & save</Button></div>
  </main>
}
const Metric = ({ label, value }: { label: string; value: string }) => <div><span>{label}</span><strong>{value}</strong></div>

const Paused = ({ store }: { store: MobileStore }) => {
  const session = useStore(store, (state) => state.session)
  const requests = useStore(store, (state) => state.requests)
  const resume = useStore(store, (state) => state.resumeWorkout)
  const finish = useStore(store, (state) => state.finishWorkout)
  if (!isAvailableSession(session)) return <Home store={store} />
  return <main className="app-shell state-screen"><TopBar title="Ride paused" /><section className="state-hero"><Pause /><p>PAUSED</p><h1>{duration(session.metrics.activeDurationMs)}</h1><span>{distance(session.metrics.distanceM)} recorded</span></section><section className="paused-actions"><Button variant="primary" disabled={pending(requests, 'workout-')} onClick={() => void resume()}><Play /> Resume ride</Button><Button disabled={pending(requests, 'workout-')} onClick={() => void finish()}><CheckCircle2 /> Finish & save</Button></section><UtilityButtons store={store} /></main>
}

const Recovery = ({ store }: { store: MobileStore }) => {
  const session = useStore(store, (state) => state.session)
  const requests = useStore(store, (state) => state.requests)
  const recover = useStore(store, (state) => state.recoverWorkout)
  if (!isAvailableSession(session)) return <Home store={store} />
  return <main className="app-shell state-screen"><TopBar title="Ride recovery" /><section className="state-hero warning"><CircleAlert /><p>RECORDING INTERRUPTED</p><h1>{duration(session.metrics.activeDurationMs)}</h1><span>{session.recovery.reason ?? 'Native recording continuity was lost. Unknown gap time was not counted.'}</span></section><div className="recovery-details"><span>Last known continuity</span><strong>{session.recovery.interruptionStartedAt ? new Date(session.recovery.interruptionStartedAt).toLocaleString() : 'Unknown'}</strong></div><section className="paused-actions"><Button variant="primary" disabled={pending(requests, 'workout-')} onClick={() => void recover('resume')}><Play /> Resume saved ride</Button><Button disabled={pending(requests, 'workout-')} onClick={() => void recover('finish')}><CheckCircle2 /> Finish saved workout</Button></section></main>
}

const Saved = ({ store }: { store: MobileStore }) => {
  const session = useStore(store, (state) => state.session)
  const trail = useStore(store, (state) => state.trail)
  const savedId = useStore(store, (state) => state.savedWorkoutId)
  const requests = useStore(store, (state) => state.requests)
  const notice = useStore(store, (state) => state.notices.recording)
  const exportWorkout = useStore(store, (state) => state.exportWorkout)
  const setScreen = useStore(store, (state) => state.setScreen)
  if (!isAvailableSession(session)) return <Home store={store} />
  return <main className="app-shell saved-screen"><TopBar title="Ride saved" /><section className="saved-heading"><CheckCircle2 /><p>SAVED LOCALLY</p><h1>{distance(session.metrics.distanceM)}</h1><span>{duration(session.metrics.activeDurationMs)} active · {Math.round(session.metrics.elevationGainM)} m ascent</span></section><RideMap trail={trail} quality={session.metrics.locationQuality} /><p className="saved-id">Workout {savedId ?? session.sessionId}</p><div className="export-actions"><Button disabled={pending(requests, 'workout-export')} onClick={() => void exportWorkout('gpx')}><Share2 /> Export GPX</Button><Button disabled={pending(requests, 'workout-export')} onClick={() => void exportWorkout('workoutBundleV1')}><Download /> Export lossless bundle</Button></div>{notice && <p className="notice">{notice}</p>}<Button className="full" variant="primary" onClick={() => setScreen('home')}>Done · Home</Button></main>
}

const HeartRate = ({ store }: { store: MobileStore }) => {
  const heartRate = useStore(store, (state) => state.heartRate)
  const permissions = useStore(store, (state) => state.permissions)
  const requests = useStore(store, (state) => state.requests)
  const notice = useStore(store, (state) => state.notices.sensors)
  const back = useStore(store, (state) => state.returnFromUtility)
  const request = useStore(store, (state) => state.requestPermission)
  const scan = useStore(store, (state) => state.scanHeartRate)
  const stopScan = useStore(store, (state) => state.stopHeartRateScan)
  const connect = useStore(store, (state) => state.connectHeartRate)
  const disconnect = useStore(store, (state) => state.disconnectHeartRate)
  const busy = pending(requests)
  return <main className="app-shell"><TopBar title="Heart-rate monitor" back={back} /><section className="page-heading"><HeartPulse className="heading-icon" /><h1>{heartRate?.state === 'connected' ? `${heartRate.latestMeasurement?.bpm ?? '—'} bpm` : 'Optional sensor'}</h1><p>A monitor is never required to start or continue recording.</p></section><section className="card sensor-card"><div><span>Status</span><strong>{heartRate?.reason ?? 'Reading native Bluetooth state…'}</strong></div><Pill tone={heartRate?.state === 'connected' ? 'good' : 'neutral'}>{heartRate?.state ?? 'loading'}</Pill></section>
    {permissions?.bluetooth.details.authorization === 'notDetermined' && <Button className="full" onClick={() => void request('bluetooth')} disabled={busy}>Allow Bluetooth</Button>}
    <div className="device-list">{heartRate?.devices.map((device) => <article key={device.deviceId}><div><strong>{device.name ?? 'Unnamed HR monitor'}</strong><small>RSSI {device.rssi ?? '—'} · {age(device.lastSeenAt)}</small></div><Button disabled={busy || heartRate.state === 'connected'} onClick={() => void connect(device.deviceId)}>Connect</Button></article>)}</div>
    <div className="sheet-actions">{heartRate?.state === 'scanning' ? <Button onClick={() => void stopScan()} disabled={busy}>Stop scan</Button> : <Button variant="primary" onClick={() => void scan()} disabled={busy}>Scan for monitors</Button>}<Button variant="danger" onClick={() => void disconnect()} disabled={busy || !heartRate?.connectionId}>Disconnect</Button></div>{notice && <p className="notice">{notice}</p>}
  </main>
}

const Settings = ({ store }: { store: MobileStore }) => {
  const builds = useStore(store, (state) => state.builds)
  const requests = useStore(store, (state) => state.requests)
  const devUrl = useStore(store, (state) => state.developmentSourceDraft)
  const uiSource = useStore(store, (state) => state.uiSource)
  const back = useStore(store, (state) => state.returnFromUtility)
  const setDevUrl = useStore(store, (state) => state.setDevelopmentSourceDraft)
  const reload = useStore(store, (state) => state.reload)
  const configure = useStore(store, (state) => state.configureDevelopmentSource)
  const install = useStore(store, (state) => state.installBuild)
  const rollback = useStore(store, (state) => state.rollback)
  const [manifest, setManifest] = useState(defaultManifestUrl)
  const busy = pending(requests)
  return <main className="app-shell"><TopBar title="App source" back={back} /><section className="page-heading"><Wifi className="heading-icon" /><h1>Web delivery</h1><p>Reloading the UI reconnects to the same native workout and does not reset recording.</p></section><section className="card build-card"><div className="card-title"><Wifi /><div><span>Native-authoritative source</span><strong>{uiSource?.configured.kind === 'development' ? uiSource.configured.url : uiSource ? `${uiSource.configured.kind} · ${uiSource.configured.buildId}` : 'Waiting…'}</strong></div><Pill tone={uiSource?.loadState === 'failed' ? 'error' : 'good'}>{uiSource?.loadState ?? 'loading'}</Pill></div><dl><div><dt>Loaded</dt><dd>{uiSource?.loadedUrl ?? '—'}</dd></div><div><dt>UI build</dt><dd>{builds?.active.buildId ?? '—'}</dd></div><div><dt>Engine</dt><dd>{builds?.active.engineBuildId ?? '—'}</dd></div></dl></section>
    <section className="form-section"><label htmlFor="dev-url">Development server URL</label><div className="input-row"><input id="dev-url" value={devUrl} placeholder={recommendedDevelopmentUrl} onChange={(event) => setDevUrl(event.target.value)} /><Button disabled={busy || !devUrl} onClick={() => void configure(devUrl)}>Connect</Button></div></section><section className="form-section"><label htmlFor="manifest-url">Build manifest</label><input id="manifest-url" value={manifest} onChange={(event) => setManifest(event.target.value)} /><Button className="full" disabled={busy} onClick={() => void install(manifest)}><Download /> Install build</Button></section><section className="action-list"><button onClick={() => void reload()} disabled={busy}><RefreshCw /><span><strong>Reload current UI</strong><small>Native recorder keeps running</small></span><ChevronRight /></button><button onClick={() => void rollback('previous')} disabled={busy || !builds?.previous}><RotateCcw /><span><strong>Use previous build</strong><small>{builds?.previous?.buildId ?? 'Unavailable'}</small></span><ChevronRight /></button><button onClick={() => void rollback('bundled')} disabled={busy}><ShieldCheck /><span><strong>Use bundled build</strong><small>Known-good fallback</small></span><ChevronRight /></button></section>
  </main>
}

const Diagnostics = ({ store }: { store: MobileStore }) => {
  const bridge = useStore(store, (state) => state.bridge)
  const snapshot = useStore(store, (state) => state.diagnostics)
  const checks = useStore(store, (state) => state.checks)
  const requests = useStore(store, (state) => state.requests)
  const notice = useStore(store, (state) => state.notices.diagnostics)
  const back = useStore(store, (state) => state.returnFromUtility)
  const runChecks = useStore(store, (state) => state.runChecks)
  const exportDiagnostics = useStore(store, (state) => state.exportDiagnostics)
  return <main className="app-shell diagnostics-screen"><TopBar title="Diagnostics" back={back} /><section className="page-heading"><Pill tone={bridge.transport === 'simulator' ? 'warning' : 'good'}>{bridge.transportLabel}</Pill><h1>Native health</h1><p>Read-only status. Opening this screen never stops or changes the recorder.</p></section>{bridge.error && <p className="notice notice-error">{bridge.error}</p>}<section className="diagnostic-list">{snapshot?.rows.map((item) => <StatusItem key={item.id} item={item} />) ?? <p>Reading native snapshot…</p>}</section>{checks.length > 0 && <section className="checks"><p className="eyebrow">LAST ISOLATED CHECK</p>{checks.map((check) => <div key={check.id}><CheckCircle2 /><span><strong>{check.id}</strong><small>{check.reason}</small></span><Pill tone={check.outcome === 'pass' ? 'good' : 'error'}>{check.outcome}</Pill></div>)}</section>}<div className="sticky-actions"><Button variant="primary" onClick={() => void runChecks()} disabled={pending(requests, 'diagnostics-')}><ShieldCheck /> Run checks</Button><Button onClick={() => void exportDiagnostics()} disabled={pending(requests, 'diagnostics-')}><Share2 /> Export</Button><small>Workout observations and coordinates are excluded.</small></div>{notice && <p className="notice">{notice}</p>}</main>
}
const StatusItem = ({ item }: { item: StatusRow }) => <article className={`diagnostic-row status-${item.status}`}>{item.status === 'ok' ? <CheckCircle2 /> : <CircleAlert />}<div><div className="row-title"><strong>{item.label}</strong><Pill tone={item.status}>{item.status}</Pill></div><p>{item.reason}</p><small>{item.freshness} · {age(item.observedAt)}</small></div></article>

export const hasCapabilities = (capabilities: readonly Capability[], required: readonly Capability[]) => required.every((item) => capabilities.includes(item))

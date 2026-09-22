import { Activity, ArrowLeft, Bike, CheckCircle2, ChevronRight, CircleAlert, Database, Download, Gauge, HeartPulse, MapPin, Pause, Play, RefreshCw, Repeat2, RotateCcw, Route as RouteIcon, Settings as SettingsIcon, Share2, ShieldCheck, Upload, Wifi, FastForward } from 'lucide-react'
import { useState } from 'react'
import { useStore } from 'zustand'
import type { AvailableSessionSnapshot, Capability, RecorderLocationObservation, StatusRow } from '../../src/shared/mobile'
import { createRouteMap } from '../../src/shared/route-map'
import type { MobileStore, Screen } from './store'
import { isAvailableSession } from './store'
import { Button } from './components/Button'
import { AnnotatedRouteMap, segmentColors } from './components/AnnotatedRouteMap'
import { MapViewport } from './components/MapViewport'
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
    saved: <Saved store={store} />, history: <History store={store} />, savedDetail: <SavedDetail store={store} />, library: <Library store={store} />, libraryDetail: <LibraryDetail store={store} />, routes: <Routes store={store} />, routeDetail: <RouteDetailScreen store={store} />, heartRate: <HeartRate store={store} />, settings: <Settings store={store} />, diagnostics: <Diagnostics store={store} />, replay: <Replay store={store} />,
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
  const archiveSource = useStore(store, (state) => state.archiveSourceLabel)
  const archiveState = useStore(store, (state) => state.archiveLoadState)
  const analysisAvailable = useStore(store, (state) => state.analysisHostAvailable)
  const libraryCount = useStore(store, (state) => state.libraryWorkouts.length)
  const routeCount = useStore(store, (state) => state.routes.length)
  const localHost = Boolean(archiveSource)
  const loadReplay = useStore(store, (state) => state.loadLocalReplay)
  const locationAuth = permissions?.location.details.authorization
  const needsPermission = locationAuth === 'notDetermined'
  const denied = locationAuth === 'denied' || locationAuth === 'restricted'
  const active = isAvailableSession(session) && ['recording', 'paused', 'interrupted'].includes(session.state)
  const busy = pending(requests, 'workout-') || pending(requests, 'permission-location')
  return <main className="app-shell home-screen">
    <TopBar title="Workout Ledger" />
    <section className="home-hero"><Pill tone={localHost || bridge.phase === 'ready' ? 'good' : 'warning'}>{localHost ? 'Local Bun host' : bridge.transportLabel}</Pill><h1>{localHost ? <>Your<br /><em>rides.</em></> : <>Ready to<br /><em>ride.</em></>}</h1><p>{localHost ? 'Browse real recovered iPhone recordings and local segment analysis.' : 'GPS recording works without a heart-rate monitor or route catalog.'}</p></section>
    <section className="home-status">{localHost ? <><article><ShieldCheck /><div><span>Recovered iPhone storage</span><strong>{archiveState === 'ready' ? `${savedWorkouts.length} finished workouts · read-only` : archiveState === 'error' ? 'Archive load failed' : 'Loading durable archive…'}</strong></div></article><article><Database /><div><span>Local analysis archive</span><strong>{analysisAvailable ? `${libraryCount} workouts · ${routeCount} routes` : 'Unavailable'}</strong></div></article></> : <><article><MapPin /><div><span>GPS</span><strong>{denied ? 'Permission blocked' : permissions?.location.reason ?? 'Connecting…'}</strong></div></article><article><HeartPulse /><div><span>Heart rate · optional</span><strong>{heartRate?.connectedDevice?.name ?? heartRate?.reason ?? 'Not connected'}</strong></div></article></>}</section>
    {!recorderSupported && bridge.phase === 'ready' && <p className="notice notice-error">This installed native shell does not provide the frozen recorder capabilities. Update the shell to record; diagnostics and source utilities remain available.</p>}
    {notice && <p className="notice notice-error" role="alert">{notice}</p>}
    {(archiveSource || bridge.capabilities.includes('archive.list')) && <button className="recent-workout" onClick={() => setScreen('history')}><Activity /><span><strong>Saved iPhone workouts</strong><small>{archiveState === 'loading' ? 'Loading durable archive…' : archiveState === 'error' ? 'Archive failed to load · tap to retry' : savedWorkouts.length ? `${savedWorkouts.length} durable recordings · ${archiveSource ?? 'This iPhone'}` : 'No completed rides in archive'}</small></span><ChevronRight /></button>}
    {analysisAvailable && <section className="archive-entries"><button onClick={() => setScreen('library')}><Database /><span><strong>Workout library</strong><small>{libraryCount ? `${libraryCount} normalized workouts` : 'Loading local archive…'}</small></span><ChevronRight /></button><button onClick={() => setScreen('routes')}><RouteIcon /><span><strong>Segments & loops</strong><small>{routeCount ? `${routeCount} detected routes` : 'Loading analysis…'}</small></span><ChevronRight /></button></section>}
    {!analysisAvailable && bridge.phase === 'ready' && <p className="capability-note">Segments and library analysis are not installed in this native shell yet. Phone recording and its durable history remain available.</p>}
    {!localHost && <UtilityButtons store={store} />}
    {import.meta.env.DEV && <Button className="full replay-entry" onClick={() => void loadReplay()}><FastForward /> Load immutable local replay</Button>}
    {!localHost && <div className="home-bottom">
      {active ? <Button variant="primary" disabled={busy} onClick={() => setScreen(session!.state === 'recording' ? 'live' : session!.state === 'paused' ? 'paused' : 'recovery')}><Bike /> Return to ride</Button>
        : needsPermission ? <Button variant="primary" disabled={busy || !recorderSupported} onClick={() => void requestPermission('locationWhenInUse')}><MapPin /> Allow location to start</Button>
          : <Button variant="primary" disabled={busy || !recorderSupported || denied} onClick={() => void startWorkout('waitForReliableLocation')}><Bike /> Start ride</Button>}
      <p><ShieldCheck /> Starts immediately and waits for reliable GPS. Native recording continues if this UI reloads.</p>
    </div>}
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
    {metrics ? <><section className="durability-grid"><div><span>JOURNAL CURSOR</span><strong>{replay.checkpoint?.throughJournalSequence.toLocaleString() ?? '—'} / {replay.metadata?.lastJournalSequence.toLocaleString() ?? '—'}</strong><small>Raw sequence domain</small></div><div><span>PROJECTED INPUT</span><strong>{replay.checkpoint?.projector.observationSequence.toLocaleString() ?? '—'}</strong><small>Normalized sequence domain</small></div><div><span>DUPLICATE EVENTS</span><strong>{replay.checkpoint?.projector.duplicateEventCount ?? 0}</strong><small>Raw rows preserved, projection suppressed</small></div><div><span>UNSUPPORTED EVENTS</span><strong>{replay.checkpoint?.projector.unknownEventCount ?? 0}</strong><small>Preserved and skipped safely</small></div><div><span>MALFORMED EVENTS</span><strong>{replay.checkpoint?.projector.malformedEventCount ?? 0}</strong><small>Preserved and reported</small></div></section><RideMap trail={trail} quality={metrics.locationQuality} showTiles={false} fitRoute /><section className="speed-hero"><span>REPLAY SPEED</span><strong>{speed(metrics.currentSpeedMps)}</strong><small>km/h</small></section><section className="ride-metrics"><Metric label="Active" value={duration(metrics.activeDurationMs)} /><Metric label="Distance" value={distance(metrics.distanceM)} /><Metric label="Avg speed" value={metrics.averageSpeedMps === null ? '—' : `${speed(metrics.averageSpeedMps)} km/h`} /><Metric label="Heart rate" value={metrics.heartRateBpm === null ? '—' : `${metrics.heartRateBpm} bpm`} /><Metric label="Ascent · est." value={`${Math.round(metrics.elevationGainM)} m`} /><Metric label="Elapsed" value={duration(metrics.elapsedDurationMs)} /></section></> : <p className="notice">Loading the first replay checkpoint…</p>}
    <section className="replay-controls"><input aria-label="Replay position" type="range" min="0" max={replay.durationMs || 1} value={replay.positionMs} onChange={(event) => void seek(Number(event.target.value))} /><div><Button onClick={replay.status === 'playing' ? pause : play} disabled={replay.status === 'loading' || replay.status === 'error'}>{replay.status === 'playing' ? <><Pause /> Pause</> : <><Play /> Play</>}</Button><label>Speed<select value={replay.speed} onChange={(event) => speedAction(Number(event.target.value))}>{[0.5, 1, 2, 4, 8, 16].map((value) => <option key={value} value={value}>{value}×</option>)}</select></label><span>{duration(replay.positionMs)} / {duration(replay.durationMs)}</span></div></section>
  </main>
}

const History = ({ store }: { store: MobileStore }) => {
  const items = useStore(store, (state) => state.savedWorkouts)
  const requests = useStore(store, (state) => state.requests)
  const open = useStore(store, (state) => state.openSavedWorkout)
  const setScreen = useStore(store, (state) => state.setScreen)
  const source = useStore(store, (state) => state.archiveSourceLabel)
  const state = useStore(store, (value) => value.archiveLoadState)
  const reload = useStore(store, (value) => value.loadSavedWorkouts)
  const notice = useStore(store, (value) => value.notices.recording)
  const analysisAvailable = useStore(store, (value) => value.analysisHostAvailable)
  const normalized = useStore(store, (value) => new Set(value.libraryWorkouts.filter((workout) => workout.id.startsWith('iphone:')).map((workout) => workout.sourceActivityId)))
  return <main className="app-shell"><TopBar title="Saved workouts" back={() => setScreen('home')} /><section className="page-heading"><h1>iPhone archive</h1><p>{source ?? 'Native iPhone storage'} · durable recorder history.</p></section><section className="archive-analysis-boundary"><RouteIcon /><div><strong>{normalized.size === items.length && items.length ? 'Included in analysis' : 'Ready to import'}</strong><p>Import uses durable recorder observations without changing the original iPhone archive.</p>{analysisAvailable && <Button onClick={() => setScreen('routes')}><RefreshCw /> Import &amp; analyze</Button>}</div></section>{state === 'loading' && <p className="notice">Loading the durable archive…</p>}{state === 'error' && <><p className="notice notice-error" role="alert">{notice ?? 'The archive could not be loaded.'}</p><Button className="full" onClick={() => void reload()}><RefreshCw /> Retry archive</Button></>}<section className="history-list">{items.map((item) => <button key={item.savedWorkoutId} onClick={() => void open(item.savedWorkoutId)} disabled={pending(requests, 'archive-detail')}><Bike /><span><strong>{new Date(item.startedAt).toLocaleString()}</strong><small>{distance(item.metrics.distanceM)} · {duration(item.durationMs)} · {item.observationCount.toLocaleString()} normalized recorder events{item.rawEventCount ? ` · ${item.rawEventCount.toLocaleString()} raw` : ''} · {normalized.has(item.sessionId) ? 'included in analysis' : 'ready to import'}</small></span><ChevronRight /></button>)}{state === 'empty' && <p className="notice">The archive loaded successfully and contains no finished workouts.</p>}</section></main>
}

const SavedDetail = ({ store }: { store: MobileStore }) => {
  const detail = useStore(store, (state) => state.savedWorkoutDetail)
  const requests = useStore(store, (state) => state.requests)
  const notice = useStore(store, (state) => state.notices.recording)
  const exportSaved = useStore(store, (state) => state.exportSavedWorkout)
  const setScreen = useStore(store, (state) => state.setScreen)
  const canExport = useStore(store, (state) => state.bridge.capabilities.includes('workout.export'))
  const normalized = useStore(store, (state) => state.savedWorkoutNormalizedDetail)
  const matches = useStore(store, (state) => state.savedWorkoutMatches)
  if (!detail) return <History store={store} />
  const trail = detail.observations.items.filter((item): item is RecorderLocationObservation => item.kind === 'location' && item.horizontalAccuracyM <= 50)
  const metrics = detail.summary.metrics
  const started = new Date(detail.summary.startedAt)
  const route = normalized?.samples.map(({ lat, lon }) => ({ lat, lon })) ?? []
  const annotations = [...new Map(matches.map((match) => [match.routeId, match])).values()].map((match, index) => ({ id: match.routeId, label: match.routeName, points: match.geometry, color: segmentColors[index % segmentColors.length]! }))
  return <main className="app-shell saved-screen"><TopBar title="Saved ride" back={() => setScreen('history')} /><header className="workout-heading"><p className="eyebrow">CYCLING · DURABLE IPHONE RECORD</p><h1>{started.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h1><div><span>{started.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span><strong>{distance(metrics.distanceM)}</strong><span>{duration(detail.summary.durationMs)}</span></div></header>{normalized ? <section className="analysis-boundary"><RouteIcon /><div><strong>{matches.length ? `${matches.length} matched route ${matches.length === 1 ? 'effort' : 'efforts'}` : 'Included in normalized analysis'}</strong><p>{matches.length ? 'Matched routes are overlaid below.' : 'No segment match was detected in the latest rebuild.'}</p></div></section> : <section className="analysis-boundary"><RouteIcon /><div><strong>Ready to import</strong><p>Use Import &amp; rebuild analysis on Segments &amp; loops.</p></div></section>}{normalized && route.length > 1 ? matches.length ? <AnnotatedRouteMap points={route} annotations={annotations} label={`iPhone workout with ${matches.length} matched route efforts`} /> : <RouteGeometryMap points={route} /> : <RideMap trail={trail} quality={metrics.locationQuality} fitRoute />}<section className="ride-metrics saved-metrics"><Metric label="Active" value={duration(metrics.activeDurationMs)} /><Metric label="Distance" value={distance(metrics.distanceM)} /><Metric label="Avg speed" value={metrics.averageSpeedMps === null ? '—' : `${speed(metrics.averageSpeedMps)} km/h`} /><Metric label="Heart rate" value={metrics.heartRateBpm === null ? '—' : `${metrics.heartRateBpm} bpm`} /><Metric label="Ascent · est." value={`${Math.round(metrics.elevationGainM)} m`} /><Metric label="GPS points" value={trail.length.toLocaleString()} /></section><p className="saved-id">{detail.summary.observationCount.toLocaleString()} normalized recorder events · {detail.summary.rawEventCount?.toLocaleString() ?? '—'} raw events<br />Session {detail.summary.sessionId}<br />Engine {detail.pinnedEngine.buildId}</p>{detail.summary.hasFatalIssue && <p className="notice notice-error">This workout contains a fatal recording issue.</p>}{canExport ? <div className="export-actions"><Button disabled={pending(requests, 'archive-export')} onClick={() => void exportSaved(detail.summary.sessionId, 'gpx')}><Share2 /> Export GPX</Button><Button disabled={pending(requests, 'archive-export')} onClick={() => void exportSaved(detail.summary.sessionId, 'workoutBundleV1')}><Download /> Export complete raw bundle</Button></div> : <p className="notice">Recovered archive browsing is read-only. Export is available when this same UI is hosted by the native iPhone shell.</p>}{notice && <p className="notice">{notice}</p>}</main>
}

const RouteGeometryMap = ({ points, interactive = true }: { points: readonly { lat: number; lon: number }[]; interactive?: boolean }) => {
  const map = createRouteMap(points, 320, 190, 16)
  if (!map) return <div className="route-geometry map-empty"><MapPin /><strong>Route unavailable</strong></div>
  return <MapViewport className={`route-geometry${interactive ? ' map-bleed' : ''}`} label={`Route map with ${points.length.toLocaleString()} points`} interactive={interactive}><svg viewBox="0 0 320 190" preserveAspectRatio="none"><path className="trail-shadow" d={map.path} /><path className="trail-line" d={map.path} /><circle className="route-start" cx={map.start.x} cy={map.start.y} r="4" /><circle className="rider" cx={map.end.x} cy={map.end.y} r="5" /></svg></MapViewport>
}

const Library = ({ store }: { store: MobileStore }) => {
  const items = useStore(store, (state) => state.libraryWorkouts)
  const requests = useStore(store, (state) => state.requests)
  const open = useStore(store, (state) => state.openLibraryWorkout)
  const setScreen = useStore(store, (state) => state.setScreen)
  const notice = useStore(store, (state) => state.notices.recording)
  const exportArchive = useStore(store, (state) => state.exportCanonicalArchive)
  const importArchive = useStore(store, (state) => state.importCanonicalArchive)
  const progress = useStore(store, (state) => state.archiveTransferProgress)
  const imported = useStore(store, (state) => state.archiveImport)
  const nativeImport = useStore(store, (state) => state.bridge.capabilities.includes('file.pickArchive'))
  const transferBusy = pending(requests, 'archive-transfer-')
  const progressText = progress ? `${progress.stage} ${progress.total ? Math.round(progress.completed / progress.total * 100) : 0}%` : null
  return <main className="app-shell"><TopBar title="Workout library" back={() => setScreen('home')} /><section className="page-heading"><Database className="heading-icon" /><h1>{items.length} workouts</h1><p>Normalized local DuckDB archive. This is separate from the iPhone recorder journal.</p></section><section className="analysis-action"><div><strong>Portable canonical archive</strong><small>{progressText ?? (nativeImport ? 'Import a bundle from Files. Analysis is rebuilt separately.' : 'Download normalized workouts and samples for manual transfer to iPhone.')}</small>{imported && <small>{imported.inserted} inserted · {imported.unchanged} unchanged · {imported.conflicts.length} conflicts</small>}</div>{nativeImport ? <Button disabled={transferBusy} onClick={() => void importArchive()}><Upload /> {transferBusy ? 'Importing…' : 'Import from Files'}</Button> : <Button disabled={transferBusy || items.length === 0} onClick={() => void exportArchive()}><Download /> {transferBusy ? 'Exporting…' : 'Download archive'}</Button>}</section>{imported?.analysisRebuildRequired && <p className="notice">Canonical history is imported. Open Segments &amp; loops and tap Rebuild analysis; derived Mac analysis was intentionally not transferred.</p>}{pending(requests, 'library-list') && items.length === 0 && <p className="notice">Loading workout history…</p>}{notice && <p className={requests['archive-transfer-import']?.status === 'error' ? 'notice notice-error' : 'notice'}>{notice}</p>}<section className="history-list">{items.map((item) => <button key={item.id} onClick={() => void open(item.id)} disabled={pending(requests, 'library-detail')}><Bike /><span><strong>{new Date(item.startedAt).toLocaleDateString()} · {item.sport}</strong><small>{item.distanceM === null ? 'Distance unavailable' : distance(item.distanceM)} · {item.durationSeconds === null ? 'Duration unavailable' : duration(item.durationSeconds * 1000)}</small></span><ChevronRight /></button>)}</section></main>
}

const LibraryDetail = ({ store }: { store: MobileStore }) => {
  const workout = useStore(store, (state) => state.libraryWorkoutDetail)
  const matches = useStore(store, (state) => state.libraryWorkoutMatches)
  const openRoute = useStore(store, (state) => state.openRoute)
  const setScreen = useStore(store, (state) => state.setScreen)
  const [selectedTraversalId, setSelectedTraversalId] = useState<string | null>(null)
  if (!workout) return <Library store={store} />
  const route = workout.samples.map(({ lat, lon }) => ({ lat, lon }))
  const selected = matches.find((match) => match.traversalId === selectedTraversalId) ?? matches[0] ?? null
  const uniqueRoutes = [...new Map(matches.map((match) => [match.routeId, match])).values()]
  const annotations = uniqueRoutes.map((match, index) => ({ id: match.routeId, label: match.routeName, points: match.geometry, color: segmentColors[index % segmentColors.length]! }))
  const startOffset = selected ? Math.max(0, new Date(selected.startedAt).getTime() - new Date(workout.startedAt).getTime()) : 0
  return <main className="app-shell"><TopBar title="Workout" back={() => setScreen('library')} /><header className="workout-heading"><p className="eyebrow">{workout.sport.toUpperCase()} · NORMALIZED ARCHIVE</p><h1>{new Date(workout.startedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h1><div><strong>{workout.distanceM === null ? '—' : distance(workout.distanceM)}</strong><span>{workout.durationSeconds === null ? '—' : duration(workout.durationSeconds * 1000)}</span></div></header>{route.length > 1 && (matches.length ? <AnnotatedRouteMap points={route} annotations={annotations} selectedId={selected?.routeId} onSelect={(routeId) => setSelectedTraversalId(matches.find((match) => match.routeId === routeId)?.traversalId ?? null)} label={`Workout map with ${matches.length} matched route traversals`} /> : <RouteGeometryMap points={route} />)}{selected && <section className="selected-effort"><div className="selected-effort-title"><i style={{ background: annotations.find((item) => item.id === selected.routeId)?.color }} /><span><small>SELECTED {selected.routeType.toUpperCase()}</small><strong>{selected.routeName}</strong></span></div><div className="effort-stats"><Metric label="Starts at" value={duration(startOffset)} /><Metric label="Effort" value={duration(selected.durationSec * 1000)} /><Metric label="Quality" value={`${Math.round(selected.qualityScore * 100)}%`} /><Metric label="Avg HR" value={selected.avgHeartRate === null ? '—' : `${Math.round(selected.avgHeartRate)} bpm`} /></div><Button className="full" onClick={() => void openRoute(selected.routeId)}><RouteIcon /> Open segment history</Button></section>}<section className="ride-metrics saved-metrics"><Metric label="Ascent" value={workout.ascentM === null ? '—' : `${Math.round(workout.ascentM)} m`} /><Metric label="Avg HR" value={workout.avgHrBpm === null ? '—' : `${Math.round(workout.avgHrBpm)} bpm`} /><Metric label="Max HR" value={workout.maxHrBpm === null ? '—' : `${Math.round(workout.maxHrBpm)} bpm`} /><Metric label="GPS points" value={route.length.toLocaleString()} /></section><section className="sublist effort-list"><h2>Matched segments & loops</h2>{matches.map((match, index) => <button className={match.traversalId === selected?.traversalId ? 'is-selected' : ''} key={match.traversalId} onClick={() => setSelectedTraversalId(match.traversalId)}><i style={{ background: annotations.find((item) => item.id === match.routeId)?.color ?? segmentColors[index % segmentColors.length] }} /><span><strong>{match.routeName}</strong><small>{duration(Math.max(0, new Date(match.startedAt).getTime() - new Date(workout.startedAt).getTime()))} into ride · {duration(match.durationSec * 1000)} · quality {Math.round(match.qualityScore * 100)}%</small></span><ChevronRight /></button>)}{matches.length === 0 && <p className="notice">Analysis completed, but no detected segments or loops matched this workout.</p>}</section></main>
}

const Routes = ({ store }: { store: MobileStore }) => {
  const routes = useStore(store, (state) => state.routes)
  const settings = useStore(store, (state) => state.analysisSettings)
  const requests = useStore(store, (state) => state.requests)
  const open = useStore(store, (state) => state.openRoute)
  const rebuild = useStore(store, (state) => state.rebuildAnalysis)
  const setScreen = useStore(store, (state) => state.setScreen)
  const notice = useStore(store, (state) => state.notices.recording)
  const rebuilding = pending(requests, 'analysis-rebuild')
  const ingestion = useStore(store, (state) => state.iphoneIngestion)
  return <main className="app-shell"><TopBar title="Segments & loops" back={() => setScreen('home')} /><section className="page-heading"><RouteIcon className="heading-icon" /><h1>{routes.length} routes</h1><p>Detected by shared TypeScript analysis over the normalized local archive.</p></section><section className="analysis-action"><div><strong>{settings?.analyzedAt ? `Last rebuilt ${new Date(settings.analyzedAt).toLocaleString()}` : 'Analysis has not been built yet'}</strong><small>{ingestion ? `${ingestion.discovered} iPhone workouts included · ${ingestion.imported} updated, ${ingestion.unchanged} unchanged.` : 'Imports new or changed iPhone recordings, then rebuilds derived route matches.'}</small></div><Button disabled={rebuilding} onClick={() => void rebuild()}><RefreshCw /> {rebuilding ? 'Importing & rebuilding…' : 'Import & rebuild analysis'}</Button></section>{notice && <p className="notice notice-error">{notice}</p>}<section className="route-list">{routes.map((route) => <button key={route.id} onClick={() => void open(route.id)} disabled={pending(requests, 'route-detail')}><RouteGeometryMap points={route.geometry} interactive={false} /><div><span className={`route-kind route-kind-${route.type}`}>{route.type === 'loop' ? <Repeat2 /> : <RouteIcon />}{route.type}</span><h2>{route.name}</h2><p>{distance(route.distanceM)} · {route.workoutCount} workouts · {route.traversalCount} traversals</p></div></button>)}</section></main>
}

const RouteDetailScreen = ({ store }: { store: MobileStore }) => {
  const route = useStore(store, (state) => state.routeDetail)
  const setScreen = useStore(store, (state) => state.setScreen)
  const openWorkout = useStore(store, (state) => state.openLibraryWorkout)
  const [selectedEffortId, setSelectedEffortId] = useState<string | null>(null)
  if (!route) return <Routes store={store} />
  const effort = route.traversals.find((item) => item.id === selectedEffortId) ?? route.traversals[0] ?? null
  const effortRoute = effort?.activityRoute.length ? effort.activityRoute : route.geometry
  return <main className="app-shell"><TopBar title={route.type === 'loop' ? 'Loop' : 'Segment'} back={() => setScreen('routes')} /><section className="route-detail-heading"><span className={`route-kind route-kind-${route.type}`}>{route.type === 'loop' ? <Repeat2 /> : <RouteIcon />}{route.type}</span><h1>{route.name}</h1><p>{route.sport} · {distance(route.distanceM)} · {route.workoutCount} workouts</p></section><AnnotatedRouteMap points={effortRoute} annotations={[{ id: route.id, label: route.name, points: route.geometry, color: segmentColors[0] }]} selectedId={route.id} label={effort ? `${route.name} highlighted on the selected effort's workout` : `${route.name} route`} />{effort && <section className="selected-effort"><div className="selected-effort-title"><i style={{ background: segmentColors[0] }} /><span><small>SELECTED EFFORT · {new Date(effort.startedAt).toLocaleDateString()}</small><strong>{duration(effort.durationSec * 1000)} · quality {Math.round(effort.qualityScore * 100)}%</strong></span></div><div className="effort-stats"><Metric label="Distance" value={distance(effort.distanceM)} /><Metric label="Avg speed" value={effort.avgSpeed === null ? '—' : `${speed(effort.avgSpeed)} km/h`} /><Metric label="Avg HR" value={effort.avgHeartRate === null ? '—' : `${Math.round(effort.avgHeartRate)} bpm`} /><Metric label={route.type === 'loop' ? 'Laps' : 'Pass'} value={effort.lapCount.toLocaleString()} /></div><Button className="full" onClick={() => void openWorkout(effort.activityId)}><Bike /> Open full workout</Button></section>}<section className="ride-metrics saved-metrics"><Metric label="Traversals" value={route.traversalCount.toLocaleString()} /><Metric label="Match" value={`${Math.round(route.matchScore * 100)}%`} /><Metric label="First" value={new Date(route.firstTraversalAt).toLocaleDateString()} /><Metric label="Latest" value={new Date(route.lastTraversalAt).toLocaleDateString()} /></section><section className="sublist effort-list"><h2>Efforts</h2>{route.traversals.map((item) => <button className={item.id === effort?.id ? 'is-selected' : ''} key={item.id} onClick={() => setSelectedEffortId(item.id)}><i style={{ background: segmentColors[0] }} /><span><strong>{new Date(item.startedAt).toLocaleDateString()} · {duration(item.durationSec * 1000)}</strong><small>{item.avgSpeed === null ? 'Speed unavailable' : `${speed(item.avgSpeed)} km/h`} · {item.avgHeartRate === null ? 'HR unavailable' : `${Math.round(item.avgHeartRate)} bpm`} · quality {Math.round(item.qualityScore * 100)}%</small></span><ChevronRight /></button>)}</section></main>
}

const RideMap = ({ trail, quality, showTiles = true, fitRoute = false }: { trail: readonly RecorderLocationObservation[]; quality: AvailableSessionSnapshot['metrics']['locationQuality']; showTiles?: boolean; fitRoute?: boolean }) => {
  const points = trail.map((item) => ({ lat: item.latitudeDegrees, lon: item.longitudeDegrees }))
  const last = points.at(-1)
  const fitted = fitRoute ? createRouteMap(points, 320, 220, 18) : null
  const zoom = 15
  const world = 256 * 2 ** zoom
  const project = ({ lat, lon }: { lat: number; lon: number }) => ({ x: (lon + 180) / 360 * world, y: (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * world })
  const center = last ? project(last) : null
  const tiles = !fitted && center ? [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => ({ href: `https://tile.openstreetmap.org/${zoom}/${Math.floor(center.x / 256) + dx}/${Math.floor(center.y / 256) + dy}.png`, x: (Math.floor(center.x / 256) + dx) * 256 - center.x + 160, y: (Math.floor(center.y / 256) + dy) * 256 - center.y + 110 }))) : fitted?.tiles ?? []
  const path = center ? points.map((point) => { const value = project(point); return `${value.x - center.x + 160},${value.y - center.y + 110}` }).join(' ') : ''
  const rider = fitted?.end ?? (last ? { x: 160, y: 110 } : null)
  return <MapViewport className={`ride-map map-bleed${fitted ? ' ride-map-fitted' : ''}`} label={`${fitRoute ? 'Complete recorded route' : 'Live geographic map'} with ${trail.length.toLocaleString()} GPS points`} overlay={<><Pill tone={quality === 'good' ? 'good' : 'warning'}>{quality} GPS</Pill>{showTiles && <small className="attribution">© OpenStreetMap contributors</small>}</>}>
    {showTiles && tiles.map((tile) => <img key={`${tile.href}-${tile.x}-${tile.y}`} src={tile.href} alt="" style={{ left: tile.x, top: tile.y }} />)}
    <svg viewBox="0 0 320 220" preserveAspectRatio="none" aria-hidden="true">{fitted ? <><path className="trail-shadow" d={fitted.path} /><path className="trail-line" d={fitted.path} /><circle className="route-start" cx={fitted.start.x} cy={fitted.start.y} r="4" /></> : path && <><polyline className="trail-shadow" points={path} /><polyline className="trail-line" points={path} /></>} {rider && <><circle className="rider-ring" cx={rider.x} cy={rider.y} r="13" /><circle className="rider" cx={rider.x} cy={rider.y} r="6" /></>}</svg>
    {!last && <div className="map-empty"><MapPin /><strong>Waiting for reliable GPS</strong><span>The ride is already saved and timing.</span></div>}
  </MapViewport>
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
  return <main className="app-shell saved-screen"><TopBar title="Ride saved" /><section className="saved-heading"><CheckCircle2 /><p>SAVED LOCALLY</p><h1>{distance(session.metrics.distanceM)}</h1><span>{duration(session.metrics.activeDurationMs)} active · {Math.round(session.metrics.elevationGainM)} m ascent</span></section><RideMap trail={trail} quality={session.metrics.locationQuality} fitRoute /><p className="saved-id">Workout {savedId ?? session.sessionId}</p><div className="export-actions"><Button disabled={pending(requests, 'workout-export')} onClick={() => void exportWorkout('gpx')}><Share2 /> Export GPX</Button><Button disabled={pending(requests, 'workout-export')} onClick={() => void exportWorkout('workoutBundleV1')}><Download /> Export lossless bundle</Button></div>{notice && <p className="notice">{notice}</p>}<Button className="full" variant="primary" onClick={() => setScreen('home')}>Done · Home</Button></main>
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
  const bridge = useStore(store, (state) => state.bridge)
  const builds = useStore(store, (state) => state.builds)
  const requests = useStore(store, (state) => state.requests)
  const devUrl = useStore(store, (state) => state.developmentSourceDraft)
  const uiSource = useStore(store, (state) => state.uiSource)
  const back = useStore(store, (state) => state.returnFromUtility)
  const setDevUrl = useStore(store, (state) => state.setDevelopmentSourceDraft)
  const reconnectBridge = useStore(store, (state) => state.reconnectBridge)
  const reload = useStore(store, (state) => state.reload)
  const configure = useStore(store, (state) => state.configureDevelopmentSource)
  const install = useStore(store, (state) => state.installBuild)
  const rollback = useStore(store, (state) => state.rollback)
  const [manifest, setManifest] = useState(defaultManifestUrl)
  const notice = useStore(store, (state) => state.notices.settings)
  const bridgeReady = bridge.phase === 'ready'
  const sourceCommandsAvailable = bridge.capabilities.includes('devSource.configure') && bridge.capabilities.includes('ui.reload')
  const canConfigure = bridgeReady && sourceCommandsAvailable
  const bridgeMissing = bridge.transportLabel === 'Native bridge unavailable'
  const sourceBusy = pending(requests, 'dev-source') || pending(requests, 'bridge-connect')
  const buildBusy = pending(requests, 'install-build') || pending(requests, 'rollback-') || pending(requests, 'ui-reload')
  const sourceLabel = uiSource?.configured.kind === 'development' ? uiSource.configured.url : uiSource ? `${uiSource.configured.kind} · ${uiSource.configured.buildId}` : bridge.phase === 'connecting' ? 'Contacting native shell…' : bridge.phase === 'error' ? 'Native source unavailable' : 'Source details unavailable'
  const sourceState = uiSource?.loadState ?? bridge.phase
  const sourceTone = bridge.phase === 'error' || uiSource?.loadState === 'failed' ? 'error' : bridge.phase === 'connecting' || !uiSource ? 'warning' : 'good'
  const unavailableDetail = bridge.phase === 'error'
    ? bridgeMissing
      ? 'This page is not inside the installed iPhone app, so it cannot read or change the native-authoritative source. Open Web delivery in the Workout Analyze app.'
      : `${bridge.error ?? 'The native bridge did not answer.'} The native shell is present but did not complete its handshake.`
    : bridgeReady && !uiSource
      ? 'The bridge connected, but native source details have not loaded. Retry before changing delivery settings.'
      : bridgeReady && !sourceCommandsAvailable
        ? 'This installed shell does not support development-source changes. Update the native app to enable Connect.'
      : null
  return <main className="app-shell"><TopBar title="App source" back={back} /><section className="page-heading"><Wifi className="heading-icon" /><h1>Web delivery</h1><p>Reloading the UI reconnects to the same native workout and does not reset recording.</p></section><section className="card build-card"><div className="card-title"><Wifi /><div><span>Native-authoritative source</span><strong>{sourceLabel}</strong></div><Pill tone={sourceTone}>{sourceState}</Pill></div><dl><div><dt>Loaded</dt><dd>{uiSource?.loadedUrl ?? '—'}</dd></div><div><dt>UI build</dt><dd>{builds?.active.buildId ?? '—'}</dd></div><div><dt>Engine</dt><dd>{builds?.active.engineBuildId ?? '—'}</dd></div></dl></section>
    {unavailableDetail && <section className="delivery-status" role="status"><p className={bridge.phase === 'error' ? 'notice notice-error' : 'notice'}>{unavailableDetail}</p>{!bridgeMissing && (bridge.phase === 'error' || sourceCommandsAvailable) && <Button onClick={() => void reconnectBridge()} disabled={sourceBusy}><RefreshCw /> {sourceBusy ? 'Retrying…' : 'Retry native connection'}</Button>}</section>}
    <section className="form-section"><label htmlFor="dev-url">Development server URL</label><div className="input-row"><input id="dev-url" value={devUrl} placeholder={recommendedDevelopmentUrl} onChange={(event) => setDevUrl(event.target.value)} /><Button disabled={!canConfigure || sourceBusy || !devUrl.trim()} onClick={() => void configure(devUrl.trim())}>{sourceBusy ? 'Connecting…' : 'Connect'}</Button></div>{!bridgeReady && <small className="field-help">Connect becomes available after the native bridge answers. You can edit the URL while waiting.</small>}</section><section className="form-section"><label htmlFor="manifest-url">Build manifest</label><input id="manifest-url" value={manifest} onChange={(event) => setManifest(event.target.value)} /><Button className="full" disabled={!bridgeReady || buildBusy || !bridge.capabilities.includes('appBuild.download') || !bridge.capabilities.includes('appBuild.activate') || !manifest.trim()} onClick={() => void install(manifest.trim())}><Download /> Install build</Button></section><section className="action-list"><button onClick={() => void reload()} disabled={!bridgeReady || buildBusy || !bridge.capabilities.includes('ui.reload')}><RefreshCw /><span><strong>Reload current UI</strong><small>Native recorder keeps running</small></span><ChevronRight /></button><button onClick={() => void rollback('previous')} disabled={!bridgeReady || buildBusy || !bridge.capabilities.includes('appBuild.rollback') || !builds?.previous}><RotateCcw /><span><strong>Use previous build</strong><small>{builds?.previous?.buildId ?? 'Unavailable'}</small></span><ChevronRight /></button><button onClick={() => void rollback('bundled')} disabled={!bridgeReady || buildBusy || !bridge.capabilities.includes('appBuild.rollback')}><ShieldCheck /><span><strong>Use bundled build</strong><small>Known-good fallback</small></span><ChevronRight /></button></section>
    {notice && <p className="notice notice-error" role="alert">{notice}</p>}
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

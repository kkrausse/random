import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BridgeClient, BridgeState } from './bridge/client'
import { createMobileStore } from './store'
import type { MobileState } from './store'
import { App, History, Library, Routes, selectLibraryWorkouts } from './App'

describe('Saved iPhone Workouts page', () => {
  test('does not mistake the native saved-workout archive for a local Bun analysis host', () => {
    const bridge: BridgeState = { phase: 'ready', transport: 'native', transportLabel: 'Native iPhone shell', lastSequence: 1, resyncCount: 0, session: null, capabilities: ['archive.list', 'file.pickArchive'], snapshot: null, error: null }
    const store = createMobileStore({ getState: () => bridge } as BridgeClient)
    store.setState({ bridge, archiveSourceLabel: 'This iPhone', archiveLoadState: 'ready' })

    const html = renderToStaticMarkup(<App store={store} />)
    expect(html).toContain('Native analysis archive unavailable')
    expect(html).not.toContain('Local Bun host')
    expect(html).not.toContain('Local analysis archive')
    expect(html).toContain('Workout library')
    expect(html).toContain('Segments &amp; loops')

    const library = renderToStaticMarkup(<Library store={store} />)
    expect(library).toContain('Import saved iPhone workouts')
    expect(library).toContain('Import from Mac')
    expect(library).toContain('disabled=""')
    expect(library).toContain('database could not open')

    const routes = renderToStaticMarkup(<Routes store={store} />)
    expect(routes).toContain('Rebuild segment analysis')
    expect(routes).toContain('database could not open')
  })

  test('shows the local analysis host when the browser has both archive adapters', () => {
    const bridge: BridgeState = { phase: 'connecting', transport: 'native', transportLabel: 'Native bridge unavailable', lastSequence: null, resyncCount: 0, session: null, capabilities: [], snapshot: null, error: null }
    const archive = { label: 'Recovered iPhone storage · read-only' } as NonNullable<Parameters<typeof createMobileStore>[1]>
    const database = {} as NonNullable<Parameters<typeof createMobileStore>[2]>
    const store = createMobileStore({ getState: () => bridge } as BridgeClient, archive, database)

    const html = renderToStaticMarkup(<App store={store} />)
    expect(html).toContain('Local Bun host')
    expect(html).toContain('Local analysis archive')
    expect(html).toContain('0 workouts · 0 routes')
  })

  test('uses a referentially stable Zustand snapshot for normalized workout status', () => {
    const libraryWorkouts: MobileState['libraryWorkouts'] = []
    const state = { libraryWorkouts } as MobileState

    expect(selectLibraryWorkouts(state)).toBe(libraryWorkouts)
    expect(selectLibraryWorkouts(state)).toBe(selectLibraryWorkouts(state))
  })

  test('renders the History screen backed by the mobile store', () => {
    const bridge: BridgeState = { phase: 'connecting', transport: 'native', transportLabel: 'Native', lastSequence: null, resyncCount: 0, session: null, capabilities: [], snapshot: null, error: null }
    const client = { getState: () => bridge } as BridgeClient
    const store = createMobileStore(client)
    const html = renderToStaticMarkup(<History store={store} />)

    expect(html).toContain('Saved workouts')
    expect(html).toContain('iPhone archive')
  })
})

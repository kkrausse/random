import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BridgeClient, BridgeState } from './bridge/client'
import { createMobileStore } from './store'
import type { MobileState } from './store'
import { History, selectLibraryWorkouts } from './App'

describe('Saved iPhone Workouts page', () => {
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

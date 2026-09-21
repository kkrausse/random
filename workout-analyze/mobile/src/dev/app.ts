import type { MobileState, MobileStore } from '../store'

export const actionKeys = [
  'refresh', 'reconnectBridge', 'setScreen', 'returnFromUtility', 'setDevelopmentSourceDraft',
  'startWorkout', 'pauseWorkout', 'resumeWorkout', 'finishWorkout', 'recoverWorkout', 'exportWorkout',
  'loadSavedWorkouts', 'openSavedWorkout', 'exportSavedWorkout', 'requestPermission',
  'startLocation', 'stopLocation', 'readLocations', 'scanHeartRate', 'stopHeartRateScan',
  'connectHeartRate', 'disconnectHeartRate', 'readHeartRate', 'runChecks', 'exportDiagnostics',
  'reload', 'configureDevelopmentSource', 'installBuild', 'rollback',
] as const satisfies readonly (keyof MobileState)[]

type ActionKey = typeof actionKeys[number]
export type AppActions = Pick<MobileState, ActionKey>

const redactState = (state: MobileState) => ({
  ...state,
  location: state.location ? { ...state.location, latest: undefined } : null,
  locations: `[${state.locations.length} location observations redacted; call app.getState({ includeSensitive: true }) explicitly]`,
  trail: `[${state.trail.length} coordinates redacted; call app.getState({ includeSensitive: true }) explicitly]`,
  measurements: `[${state.measurements.length} heart-rate measurements redacted; call app.getState({ includeSensitive: true }) explicitly]`,
})

export const createDevApp = (store: MobileStore) => {
  const source = store.getState()
  const actions = Object.fromEntries(actionKeys.map((key) => [key, source[key]])) as AppActions
  return {
    actions,
    getState(options?: { includeSensitive?: boolean }) {
      const state = store.getState()
      return options?.includeSensitive ? state : redactState(state)
    },
  }
}

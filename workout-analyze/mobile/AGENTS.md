# Mobile web architecture

- Keep authoritative mobile application state in the per-app Zustand store in `src/store.ts`. Components subscribe with narrow selectors; do not copy bridge snapshots, permissions, sensors, diagnostics, builds, or request lifecycle into component state.
- The bridge client owns transport validation and atomic sequence/resync behavior. The store is a reactive projection of validated native state, never a competing source of native truth.
- The store owns the single native subscription, visible-only polling loop, command actions, request status/errors, and probe cleanup. Do not add component polling or bridge event subscriptions.
- Keep only genuinely ephemeral UI state local, such as unsaved form text or an open/closed presentation control.

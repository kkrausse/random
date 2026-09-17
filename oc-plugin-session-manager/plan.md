# Session manager refactor

## Handoff — implemented and live-checked

- `src/session-controller.tsx` owns state, reads, events, and actions; the plugin
  creates/disposes it and views attach/detach. `src/session-display.ts` contains
  shared formatting/usage helpers. `src/tui.tsx` owns presentation/interactions.
- Each opening resets history to one 100-session page plus current/active lookups.
  Inbox discovery uses known locations. Recency keys are pinned per opening;
  metadata and badges remain live. Reads cancel on close; mutation guards survive.
- Important runtime fix: the extracted controller initially used `.ts` and the real
  OpenCode TUI stayed on “Loading sessions…” despite successful API results.
  Renaming it to `.tsx` with the OpenTUI JSX pragma fixed reactive rendering in the
  host. Keep this extension; the mocked checks did not catch this host difference.
- Verified in actual OpenCode 2.0.7 with `termctrl`: open from Home, populated
  Active/Inactive sections, Ready/running badges, keyboard selection, selected
  context/token preview, Escape dismissal, and reopening. Archive/approval
  mutations were not exercised in that automated live check. The user subsequently
  archived a real session and reported that it looked correct; live approvals
  remain unverified.
- Terminal Control is installed globally (`termctrl 1.2.1`); its skill is linked
  under `~/.config/opencode/skills/terminal-control`. Source checkout:
  `~/Documents/anomaly/terminal-control`.
- Final checks passed: TypeScript, all 51 tests, and the read-only installed-service
  API check against OpenCode 2.0.7. The user accepted updated-time ordering and
  requested committing this version. Slight flicker was reported; measure refresh
  rendering before a small follow-up optimization.
- Preserve the pre-existing sidebar-removal changes. Keep the
  already-written high-level lifecycle tests; do not expand test work without a
  concrete need. Exact last-user-input sorting remains unavailable in this API.

## Goal

Make the picker quick to open and easy to maintain. Separate API orchestration
and session state from rendering, then keep startup work deliberately small.

## Agreed approach

1. **Extract first.** One controller per plugin instance owns session state,
   fetching, event subscriptions, and actions. Solid views read state and issue
   commands; focus, layout, keybindings, and scrolling stay in the view.
2. **Preserve the existing workflows.** Keep approvals, archive/restore,
   navigation, and current-session usage statistics. In-progress actions belong
   to the controller, so closing and reopening cannot start duplicate actions.
3. **Bound startup.** Fetch one page of up to 100 sessions. Fetch older pages on
   demand and resolve current/active/attention sessions directly when needed.
   Load detailed context only for selected or active/attention sessions.
4. **Bound inbox discovery.** Query locations known from loaded/current/active
   sessions, independently of the text filter. Fetch missing request owners
   directly. Label this as a known-location inbox; do not scan all history.
5. **Keep browsing stable.** Prefer last-user-input ordering if the API supports
   it. Until then, use updated-time recency captured per opening, keeping live
   badges fresh without reordering on output or attention changes. Explicit
   lifecycle changes still move families between Active / Inactive.

Use ordinary Solid reactive state and the existing Effect runner. Defer caching,
generic schedulers, state-machine frameworks, virtualization, archive-storage
redesign, and cross-session usage reporting until there is a demonstrated need.

## API findings

On the installed OpenCode 2.0.7 service,
`session.list({ limit: 100, order: "desc" })` returned 51 sessions in 3–4 ms,
ordered by `time.updated`, not creation time. This is a first-page API measurement,
not an end-to-end picker benchmark.

The installed OpenAPI exposes neither a last-user-input sort option nor a
corresponding session metadata timestamp. Exact server-wide user-input recency
needs upstream support; do not fetch transcripts or scan history to approximate it.

Permission/form discovery is location-scoped. Known-location discovery does not
guarantee coverage of arbitrarily old pending sessions in unknown locations.

## Validation

Keep the already-written high-level controller lifecycle checks; do not expand
test work during this refactor. Future verification should favor integration
checks against the installed OpenCode APIs over renderer details or internal
implementation assertions.

After changes, quit the TUI, run `opencode2`, and open the picker with `Alt+S` to
check actual host presentation and interaction.

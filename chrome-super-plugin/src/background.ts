// Super Extension service worker: wires up each feature and keeps it in
// step with its toggle (chrome.storage.local "features", see features.ts).
//
// Every listener is registered synchronously here; handlers check the
// toggle when they fire. Turning a feature off also unregisters its content
// scripts and disables its side panel/context menu.
import { startAutoReload } from "./autoReload";
import { getFeatures, onFeaturesChanged, type FeatureState } from "./features";
import { closePaletteIfOpen } from "./palette/background";
import { applyReadingContext, setupReadingContext } from "./reading-context/background";
import { applyTabSearchGuard } from "./tab-search-guard/background";

setupReadingContext();

// Serialized so a quick off/on/off can't interleave registrations.
let applying: Promise<void> = Promise.resolve();

function apply(state: FeatureState, previous: FeatureState | null, inject: boolean) {
  applying = applying.then(async () => {
    const changed = (id: keyof FeatureState) => !previous || previous[id] !== state[id];
    // Re-inject into open tabs after install/reload, or when switched on.
    const injectFor = (id: keyof FeatureState) => inject || (previous !== null && !previous[id] && state[id]);
    if (changed("readingContext") || inject) await applyReadingContext(state.readingContext, { inject: injectFor("readingContext") });
    if (changed("tabSearchGuard") || inject) await applyTabSearchGuard(state.tabSearchGuard, { inject: injectFor("tabSearchGuard") });
    if (previous && previous.palette && !state.palette) await closePaletteIfOpen();
  }).catch((error) => console.error("Applying feature toggles failed", error));
  return applying;
}

chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .catch((error) => console.warn("Could not restrict extension storage", error));

// Every service-worker start: make Chrome's state match the toggles.
void getFeatures().then((state) => apply(state, null, false));

chrome.runtime.onInstalled.addListener(() => {
  // Install, manual reload or rebuild auto-reload: open pages get the new
  // content scripts without being refreshed.
  void getFeatures().then((state) => apply(state, null, true));
  // Chrome clears dynamically registered scripts around a reload and, in
  // testing, occasionally after we had already re-registered them. Check
  // again once things have settled (registration is idempotent).
  setTimeout(() => void getFeatures().then((state) => apply(state, null, false)), 3000);
});

onFeaturesChanged((next, previous) => void apply(next, previous, false));

// With Reading Context off, the toolbar icon no longer opens its panel;
// it opens the options page instead (where it can be switched back on).
chrome.action.onClicked.addListener(() => void chrome.runtime.openOptionsPage());

startAutoReload();


// Feature toggles, stored in chrome.storage.local. Everything is on by
// default; a missing key means "on".

export type FeatureId = "readingContext" | "palette" | "tabSearchGuard";

export type FeatureState = Record<FeatureId, boolean>;

export interface FeatureInfo {
  id: FeatureId;
  title: string;
  description: string;
  shortcut?: string;
}

export const FEATURES: FeatureInfo[] = [
  {
    id: "readingContext",
    title: "Reading Context",
    description: "Side panel for asking about highlighted passages, its right-click menu, and the highlight capture on web pages.",
    shortcut: "⌘⇧E"
  },
  {
    id: "palette",
    title: "Command palette",
    description: "Spotlight-style launcher that runs commands and teaches Chrome's keyboard shortcuts.",
    shortcut: "⌘⇧P"
  },
  {
    id: "tabSearchGuard",
    title: "Keep Tab Search Shortcut",
    description: "Stops websites from swallowing ⌘⇧A (Ctrl+Shift+A) so Chrome's tab search always opens.",
    shortcut: "⌘⇧A"
  }
];

const KEY = "features";

export const DEFAULT_FEATURES: FeatureState = { readingContext: true, palette: true, tabSearchGuard: true };

export async function getFeatures(): Promise<FeatureState> {
  const stored = (await chrome.storage.local.get(KEY))[KEY] as Partial<FeatureState> | undefined;
  return { ...DEFAULT_FEATURES, ...stored };
}

export async function setFeature(id: FeatureId, enabled: boolean) {
  const current = await getFeatures();
  await chrome.storage.local.set({ [KEY]: { ...current, [id]: enabled } });
}

export function onFeaturesChanged(listener: (next: FeatureState, previous: FeatureState) => void) {
  chrome.storage.local.onChanged.addListener((changes) => {
    const change = changes[KEY];
    if (!change) return;
    listener({ ...DEFAULT_FEATURES, ...(change.newValue as Partial<FeatureState>) }, { ...DEFAULT_FEATURES, ...(change.oldValue as Partial<FeatureState>) });
  });
}

// Synchronous view for event handlers that must not await (sidePanel.open
// has to run inside the command's user gesture). null until first load.
let cached: FeatureState | null = null;
void getFeatures().then((state) => { cached ??= state; });
onFeaturesChanged((next) => { cached = next; });

export function cachedFeature(id: FeatureId): boolean | null {
  return cached ? cached[id] : null;
}

export const FEATURE_TITLES: Record<FeatureId, string> = Object.fromEntries(FEATURES.map((f) => [f.id, f.title])) as Record<FeatureId, string>;

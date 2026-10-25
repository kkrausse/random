// Unpacked extensions are served live from disk, so after `bun run build`
// (or `bun run dev`) dist/build-id.txt already holds the new id while the
// running extension is still the old code. When they differ, reload.
// Only active for unpacked ("development") installs.

const LOADED_KEY = "loadedBuildId";
const ALARM = "build-id-check";

async function isUnpacked() {
  try {
    return (await chrome.management.getSelf()).installType === "development";
  } catch {
    return false;
  }
}

async function readBuildId(): Promise<string | null> {
  try {
    const response = await fetch(chrome.runtime.getURL("build-id.txt"), { cache: "no-store" });
    return response.ok ? (await response.text()).trim() : null;
  } catch {
    return null;
  }
}

let checking: Promise<void> | null = null;

export function checkForNewBuild(): Promise<void> {
  checking ??= (async () => {
    if (!(await isUnpacked())) return;
    const onDisk = await readBuildId();
    if (!onDisk) return;
    const stored = (await chrome.storage.local.get(LOADED_KEY))[LOADED_KEY] as string | undefined;
    if (!stored) {
      await chrome.storage.local.set({ [LOADED_KEY]: onDisk });
      return;
    }
    if (stored !== onDisk) {
      // Record first: the reloaded extension starts on this build.
      await chrome.storage.local.set({ [LOADED_KEY]: onDisk });
      console.info(`Reloading for new build ${onDisk} (was ${stored})`);
      chrome.runtime.reload();
    }
  })().finally(() => {
    checking = null;
  });
  return checking;
}

export function startAutoReload() {
  chrome.runtime.onInstalled.addListener(() => {
    // A manual reload or install loads whatever is on disk right now.
    void readBuildId().then((id) => id && chrome.storage.local.set({ [LOADED_KEY]: id }));
  });
  void chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void checkForNewBuild();
  });
  void checkForNewBuild();
}

// Content scripts in already-open tabs belong to the previous extension
// instance and stop working on reload; inject the current one. content.ts
// tears down any older copy in the page, so this can't double up.
export async function reinjectContentScripts() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  await Promise.all(tabs.map((tab) => tab.id === undefined || tab.discarded ? null
    : chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }).catch(() => {})));
}

// Content scripts are registered at runtime instead of in the manifest, so
// turning a feature off really removes its script from new pages.

type Script = chrome.scripting.RegisteredContentScript;

export async function setContentScript(script: Script, enabled: boolean) {
  if (!enabled) {
    await chrome.scripting.unregisterContentScripts({ ids: [script.id] }).catch(() => {});
    return;
  }
  // Register, or update an existing registration so a rebuild's changes
  // apply. Chrome drops dynamic scripts on extension reload, possibly while
  // this runs, so retry the other way round once if one call loses the race.
  for (let attempt = 0; attempt < 3; attempt++) {
    const exists = (await chrome.scripting.getRegisteredContentScripts({ ids: [script.id] })).length > 0;
    try {
      if (exists) await chrome.scripting.updateContentScripts([script]);
      else await chrome.scripting.registerContentScripts([script]);
      return;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}

// Run something in every open http/https tab (pages loaded before the
// script was registered, or before an extension reload).
export async function inEveryWebTab(run: (tabId: number) => Promise<unknown>) {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  await Promise.all(tabs.map((tab) => tab.id === undefined || tab.discarded ? null : run(tab.id).catch(() => {})));
}

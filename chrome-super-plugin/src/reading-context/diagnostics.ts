export interface DiagnosticEntry {
  at: string;
  event: string;
  details: Record<string, string | number | boolean | null>;
}

const DIAGNOSTICS_KEY = "diagnostics";
const MAX_ENTRIES = 100;
let writeQueue = Promise.resolve();

export function recordDiagnostic(
  event: string,
  details: Record<string, string | number | boolean | null> = {}
): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    const stored = await chrome.storage.local.get(DIAGNOSTICS_KEY) as { diagnostics?: DiagnosticEntry[] };
    const entries = stored.diagnostics || [];
    entries.push({ at: new Date().toISOString(), event, details });
    await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: entries.slice(-MAX_ENTRIES) });
  }).catch((error) => {
    console.warn("Reading Context could not save diagnostics", error);
  });
  return writeQueue;
}

export async function readDiagnostics(): Promise<DiagnosticEntry[]> {
  await writeQueue;
  const stored = await chrome.storage.local.get(DIAGNOSTICS_KEY) as {
    diagnostics?: DiagnosticEntry[];
  };
  return stored.diagnostics || [];
}

export async function clearDiagnostics(): Promise<void> {
  await writeQueue;
  await chrome.storage.local.remove(DIAGNOSTICS_KEY);
}

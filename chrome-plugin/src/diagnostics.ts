export interface DiagnosticEntry {
  at: string;
  event: string;
  details: Record<string, string | number | boolean | null>;
}

const DIAGNOSTICS_KEY = "diagnostics";
const MAX_ENTRIES = 100;

export async function recordDiagnostic(
  event: string,
  details: Record<string, string | number | boolean | null> = {}
): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(DIAGNOSTICS_KEY) as {
      diagnostics?: DiagnosticEntry[];
    };
    const entries = stored.diagnostics || [];
    entries.push({ at: new Date().toISOString(), event, details });
    await chrome.storage.local.set({
      [DIAGNOSTICS_KEY]: entries.slice(-MAX_ENTRIES)
    });
  } catch (error) {
    console.warn("Reading Context could not save diagnostics", error);
  }
}

export async function readDiagnostics(): Promise<DiagnosticEntry[]> {
  const stored = await chrome.storage.local.get(DIAGNOSTICS_KEY) as {
    diagnostics?: DiagnosticEntry[];
  };
  return stored.diagnostics || [];
}

export function clearDiagnostics(): Promise<void> {
  return chrome.storage.local.remove(DIAGNOSTICS_KEY);
}

import { safeData } from "./diagnostic-data";

type Entry = { time: string; page: string; run: string; event: string; data: unknown };
function createDiagnostics() {
  const page = crypto.randomUUID();
  let run = page, pending: Entry[] = [], recent: Entry[] = [], sending = false;
  async function flush() {
    if (sending || !pending.length) return;
    sending = true;
    const batch = pending.splice(0, 5);
    try {
      const response = await fetch("/diagnostics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(batch), signal: AbortSignal.timeout(3000), keepalive: true });
      if (!response.ok) throw Error("Diagnostic upload unavailable");
    } catch { pending = [...batch, ...pending].slice(-100); }
    finally { sending = false; }
  }
  const api = {
    get run() { return run; },
    begin() { run = crypto.randomUUID(); return run; },
    record(event: string, data: unknown = {}) {
      const safe = safeData(data);
      const entry = { time: new Date().toISOString(), page, run, event, data: new TextEncoder().encode(JSON.stringify(safe)).length > 10000 ? { omitted: "Event exceeds 10KB limit" } : safe };
      recent = [...recent, entry].slice(-160); pending = [...pending, entry].slice(-100);
    },
    text() { return recent.map(entry => JSON.stringify(entry)).join("\n"); },
    flush,
  };
  if (typeof window !== "undefined") {
    setInterval(() => { void flush(); }, 1000);
    window.addEventListener("error", (event: Event) => {
      api.record("browser.error", event instanceof ErrorEvent ? { error: event.error ?? event.message, file: event.filename, line: event.lineno } : { resource: (event.target as HTMLElement)?.tagName });
      void flush();
    }, true);
    window.addEventListener("unhandledrejection", event => { api.record("browser.unhandledrejection", { error: event.reason }); void flush(); });
    window.addEventListener("pagehide", () => { api.record("page.hide"); void flush(); });
    api.record("page.boot", { origin: location.origin, isolated: crossOriginIsolated, visibility: document.visibilityState });
    document.addEventListener("visibilitychange", () => api.record("page.visibility", { visibility: document.visibilityState }));
  }
  return api;
}
declare global { var workspaceDiagnostics: ReturnType<typeof createDiagnostics> | undefined; }
export const diagnostics = globalThis.workspaceDiagnostics ??= createDiagnostics();

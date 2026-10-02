import { createStore, reconcile } from "solid-js/store";
import type { Provider, Session } from "./session.ts";
import { listClaude } from "./claude.ts";
import { listOpencode } from "./opencode.ts";
import { listCodex, closeCodex } from "./codex.ts";

const sources: Record<Provider, () => Promise<Session[]>> = { claude: listClaude, opencode: listOpencode, codex: listCodex };
export const PROVIDERS = Object.keys(sources) as Provider[];
const POLL_MS = 2000;

export type DashStore = ReturnType<typeof createDashStore>;

export function createDashStore() {
  const [state, setState] = createStore({
    sessions: { claude: [], opencode: [], codex: [] } as Record<Provider, Session[]>,
    errors: {} as Partial<Record<Provider, string>>,
    loaded: {} as Partial<Record<Provider, true>>,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function poll(p: Provider) {
    try {
      setState("sessions", p, reconcile(await sources[p](), { key: "key" }));
      setState("errors", p, undefined);
    } catch (e) {
      setState("errors", p, e instanceof Error ? e.message : String(e));
    }
    setState("loaded", p, true);
  }

  const refresh = () => Promise.all(PROVIDERS.map(poll));

  async function loop() {
    await refresh();
    timer = setTimeout(loop, POLL_MS);
  }

  return {
    state,
    refresh,
    start: () => void loop(),
    stop: () => {
      clearTimeout(timer);
      closeCodex();
    },
  };
}

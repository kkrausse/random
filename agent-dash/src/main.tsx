import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { EmbeddedTerminalRenderable, TextAttributes, type BoxRenderable, type KeyEvent } from "@opentui/core";
import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { Show, createEffect, createSignal } from "solid-js";
import { PROVIDERS, createDashStore, type DashStore } from "./store.ts";
import { NewSession } from "./new-session.tsx";
import { launch } from "./launch.ts";
import { SessionList } from "./list.tsx";
import type { Provider, Session } from "./session.ts";
import { colors, providerColor } from "./theme.ts";

const store = createDashStore();
store.start();

// A native CLI running in a PTY, drawn by OpenTUI's embedded terminal. It outlives the pane:
// going back to the list hides it, reopening shows it again.
// A new session starts under a placeholder key; `claim` finds its real row once the poller sees it.
// `fresh` marks an unused new chat: it is cached for reuse, hidden from the list, and "back" from
// it returns to the harness picker.
type Client = {
  session: Session;
  et: EmbeddedTerminalRenderable;
  proc: Bun.Subprocess;
  exited?: number;
  claim?: (s: Session) => boolean;
  fresh?: Provider;
};

const isBackKey = (key: KeyEvent) => key.sequence === "\x1d" || (key.ctrl && key.name === "]");

// ← leaves the pane when the cursor sits right after an input prompt with nothing typed before it.
// A false positive is cheap: the client stays alive and reopening restores it as it was.
const PROMPT_START = /^\s*[❯›>┃│]?\s*$/;
function atPromptStart(et: EmbeddedTerminalRenderable): boolean {
  const { lines, cursor } = et.screen();
  const before = [...(lines[cursor.y] ?? "")].slice(0, cursor.x).join("");
  return cursor.visible && PROMPT_START.test(before);
}

function App(props: { store: DashStore }) {
  const renderer = useRenderer();
  const dims = useTerminalDimensions();
  const clients = new Map<string, Client>();
  // equals:false so re-setting the same client after a claim refreshes the header.
  const [view, setView] = createSignal<Client | undefined>(undefined, { equals: false });
  const [screen, setScreen] = createSignal<"list" | "new">("list");
  const [lastPick, setLastPick] = createSignal<Provider>();
  const [live, setLive] = createSignal<ReadonlySet<string>>(new Set());
  const [freshKeys, setFreshKeys] = createSignal<ReadonlySet<string>>(new Set());
  // Used new chats whose session the poller hasn't reported yet.
  const [pending, setPending] = createSignal<Session[]>([]);
  // Remount the list on return so it re-sorts with fresh status.
  const [mount, setMount] = createSignal({ n: 0, selected: undefined as string | undefined, flash: undefined as string | undefined });
  let host!: BoxRenderable;

  const syncLive = () => {
    const alive = [...clients.values()].filter((c) => c.exited === undefined);
    setLive(new Set(alive.map((c) => c.session.key)));
    setFreshKeys(new Set(alive.filter((c) => c.fresh).map((c) => c.session.key)));
    setPending(alive.filter((c) => c.claim && !c.fresh).map((c) => c.session));
  };
  const cachedFresh = (h: Provider) => [...clients.values()].find((c) => c.fresh === h && c.exited === undefined);

  function show(c: Client | undefined) {
    for (const other of clients.values()) {
      other.et.visible = other === c;
      if (other !== c) other.et.blur();
    }
    c?.et.focus();
    setView(c);
  }

  function back(flash?: string) {
    const c = view();
    if (c?.fresh && c.exited === undefined) {
      setLastPick(c.fresh);
      show(undefined);
      setScreen("new");
      return;
    }
    if (c?.exited !== undefined) drop(c);
    show(undefined);
    setMount({ n: mount().n + 1, selected: c?.session.key, flash });
    props.store.refresh();
  }

  function drop(c: Client) {
    clients.delete(c.session.key);
    c.et.destroy();
    syncLive();
  }

  function spawn(s: Session): Client {
    const cols = dims().width, rows = Math.max(1, dims().height - 1);
    let proc: Bun.Subprocess | undefined;
    const et = new EmbeddedTerminalRenderable(renderer, {
      width: "100%",
      height: "100%",
      cols,
      rows,
      maxScrollback: 5000,
      onData: (d) => proc?.terminal?.write(d),
      onTerminalResize: (c, r) => proc?.terminal?.resize(c, r),
    });
    host.add(et);
    // Store values are proxies; Bun.spawn needs a plain array.
    proc = Bun.spawn([...s.open!.cmd], {
      cwd: existsSync(s.open!.cwd) ? s.open!.cwd : homedir(),
      env: { ...process.env, COLORTERM: "truecolor" },
      terminal: { cols, rows, data: (_t, d) => et.write(d) },
    });
    const c: Client = { session: s, et, proc };
    proc.exited.then((code) => {
      c.exited = code;
      syncLive();
      // A clean exit is the CLI's own "leave"; an error stays on screen until ctrl+].
      if (code === 0) {
        if (view() === c) back();
        else drop(c);
      } else {
        et.write(`\r\n\x1b[33m[agentdash] ${s.open!.cmd.join(" ")} exited ${code} · ctrl+] to go back\x1b[0m\r\n`);
      }
    });
    clients.set(s.key, c);
    syncLive();
    return c;
  }

  function open(s: Session) {
    show(clients.get(s.key) ?? spawn(s));
  }

  async function pick(h: Provider, dir: string) {
    const cached = cachedFresh(h);
    if (cached) {
      setScreen("list");
      show(cached);
      return;
    }
    const known = new Set(props.store.state.sessions[h].map((s) => s.key));
    const l = await launch(h, dir, known);
    const placeholder: Session = {
      provider: h, key: `new:${Date.now()}`, id: "", title: `new ${h} session`, cwd: dir, status: "working", detail: "", model: "",
      updatedAt: Date.now(), archived: false, open: { cmd: l.cmd, cwd: l.cwd },
    };
    const c = spawn(placeholder);
    c.claim = l.claim;
    c.fresh = h;
    syncLive();
    setScreen("list");
    show(c);
  }

  createEffect(() => {
    const all = PROVIDERS.flatMap((p) => props.store.state.sessions[p]);
    for (const c of [...clients.values()]) {
      // A fresh Claude chat is claimed at once (its id is known) but stays fresh until it works.
      if (c.fresh === "claude" && !c.claim && all.find((s) => s.key === c.session.key)?.status === "working") {
        c.fresh = undefined;
        syncLive();
      }
      const real = c.claim && all.find(c.claim);
      if (!real) continue;
      clients.delete(c.session.key);
      c.session = real;
      c.claim = undefined;
      if (c.fresh !== "claude") c.fresh = undefined;
      clients.set(real.key, c);
      syncLive();
      if (view() === c) setView(c);
    }
  });

  const quit = () => {
    // Clients only; every agent lives on in its own daemon.
    for (const c of clients.values()) c.proc.kill();
    props.store.stop();
    renderer.destroy();
    process.exit(0);
  };

  const sessionStatus = (s: Session) => props.store.state.sessions[s.provider].find((x) => x.key === s.key)?.status;

  useKeyboard((key) => {
    const c = view();
    if (!c) return;
    // Submitting text makes a new chat a real one: "back" now goes to the list, not the picker.
    if (c.fresh && key.name === "return" && !key.shift && !atPromptStart(c.et)) {
      c.fresh = undefined;
      syncLive();
    }
    const plainLeft = key.name === "left" && !key.ctrl && !key.meta && !key.shift && !key.option;
    // ctrl+c on an idle empty prompt would quit the client (opencode/codex) or arm Claude's exit;
    // treat it as "back" instead. Mid-turn or with text typed it passes through to clear/interrupt.
    const idleCtrlC = key.ctrl && key.name === "c" && sessionStatus(c.session) !== "working";
    if (isBackKey(key) || ((plainLeft || idleCtrlC) && c.exited === undefined && atPromptStart(c.et))) {
      key.preventDefault();
      back();
    }
  });

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={colors.bg}>
      <Show when={!view() && screen() === "new"}>
        <box flexGrow={1} minHeight={0}>
          <NewSession initial={lastPick()} active={() => !view() && screen() === "new"} cached={(h) => !!cachedFresh(h)} onCancel={() => setScreen("list")} onPick={pick} />
        </box>
      </Show>
      <box visible={!view() && screen() === "list"} flexGrow={1} minHeight={0}>
        <Show when={mount()} keyed>
          {(m) => (
            <SessionList
              store={props.store}
              initialSelected={m.selected}
              flash={m.flash}
              active={() => !view() && screen() === "list"}
              onNew={() => setScreen("new")}
              live={live}
              hidden={freshKeys}
              extra={pending}
              onOpen={open}
              onQuit={quit}
            />
          )}
        </Show>
      </box>
      <box visible={!!view()} flexGrow={1} minHeight={0} flexDirection="column">
        <box height={1} flexShrink={0} flexDirection="row" backgroundColor={colors.surfaceRaised}>
          <text wrapMode="none" flexShrink={0} fg={providerColor(view()?.session.provider ?? "")}>{` ${view()?.session.provider ?? ""} `}</text>
          <text wrapMode="none" flexGrow={1} fg={colors.text} attributes={TextAttributes.BOLD}>{view()?.session.title ?? ""}</text>
          <text wrapMode="none" flexShrink={0} fg={colors.muted}>{" ctrl+] back to list "}</text>
        </box>
        <box ref={host} flexGrow={1} minHeight={0} />
      </box>
    </box>
  );
}

await render(() => <App store={store} />, { exitOnCtrlC: false, targetFps: 30 });

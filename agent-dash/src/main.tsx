import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { EmbeddedTerminalRenderable, TextAttributes, type BoxRenderable, type KeyEvent } from "@opentui/core";
import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { Show, createEffect, createSignal } from "solid-js";
import { createDashStore, type DashStore } from "./store.ts";
import { NewSession, type Pick } from "./new-session.tsx";
import { SessionList, label } from "./list.tsx";
import { on } from "./machines.ts";
import { hasStarted, sessionKey, type Claim, type Session } from "./session.ts";
import { colors, providerColor } from "./theme.ts";

const store = createDashStore();
store.start();

// Hidden panes are closed after this long; the agents live on in their daemons and reopening is cheap.
const REAP_MS = 15 * 60 * 1000;

// A native CLI running in a PTY (over ssh for remote machines), drawn by OpenTUI's embedded
// terminal. It outlives the pane: going back to the list hides it, reopening shows it again.
// A new session starts under a placeholder key; `claim` finds its real row once its source reports it.
// `fresh` marks an unused new chat: it is cached for reuse, hidden from the list, and "back" from
// it returns to the picker.
type Client = {
  session: Session;
  et: EmbeddedTerminalRenderable;
  proc: Bun.Subprocess;
  exited?: number;
  claim?: { claim: Claim; known: ReadonlySet<string> };
  fresh?: Pick;
  /** Last time it was on screen. */
  shownAt: number;
  /** Tail of the output, to explain a failed ssh. */
  tail: string;
  /** The harness asked for mouse reports, so it draws (and copies) its own selection. */
  mouse: boolean;
  /** An escape sequence split across output chunks, kept for the next chunk. */
  carry: string;
};

// Harness output the dashboard acts on: mouse reporting on/off (DECSET 1000/1002/1003) and OSC 52
// clipboard writes, which the embedded terminal doesn't pass on to the real terminal.
const MOUSE_MODE = /\x1b\[\?([\d;]+)([hl])/g;
const OSC52 = /\x1b\]52;[^;\x07\x1b]*;([A-Za-z0-9+/=]*)(?:\x07|\x1b\\)/g;
const MOUSE_PARAMS = new Set(["1000", "1002", "1003"]);

/** The unfinished escape sequence at the end of `text`, if any. */
function unfinished(text: string): string {
  const osc = text.lastIndexOf("\x1b]52;");
  if (osc >= 0 && !/\x07|\x1b\\/.test(text.slice(osc))) return text.slice(osc, osc + 1_000_000);
  const esc = text.lastIndexOf("\x1b");
  return esc >= 0 && /^\x1b(\[\??[\d;]*|\]5?2?)?$/.test(text.slice(esc)) ? text.slice(esc) : "";
}

const isBackKey = (key: KeyEvent) => key.sequence === "\x1d" || (key.ctrl && key.name === "]");

// ← leaves the pane when the cursor sits right after an input prompt with nothing typed before it.
// A false positive is cheap: the client stays alive and reopening restores it as it was.
const PROMPT_START = /^\s*[❯›>┃│]?\s*$/;
function atPromptStart(et: EmbeddedTerminalRenderable): boolean {
  const { lines, cursor } = et.screen();
  const before = [...(lines[cursor.y] ?? "")].slice(0, cursor.x).join("");
  return cursor.visible && PROMPT_START.test(before);
}

const matches = (c: NonNullable<Client["claim"]>, ref: Session, s: Session) =>
  s.machine === ref.machine &&
  s.harness === ref.harness &&
  ("id" in c.claim ? s.id === c.claim.id : s.cwd === c.claim.firstNewIn && !c.known.has(s.key));

// sshd caps sessions per connection (MaxSessions, default 10); every pane, stream and command on a
// host shares one connection.
const SSH_REFUSED = /administratively prohibited|open failed|session request failed|Session open refused/i;

function App(props: { store: DashStore }) {
  const renderer = useRenderer();
  const dims = useTerminalDimensions();
  const clients = new Map<string, Client>();
  // equals:false so re-setting the same client after a claim refreshes the header.
  const [view, setView] = createSignal<Client | undefined>(undefined, { equals: false });
  const [screen, setScreen] = createSignal<"list" | "new">("list");
  const [lastPick, setLastPick] = createSignal<Pick>();
  const [live, setLive] = createSignal<ReadonlySet<string>>(new Set());
  const [freshKeys, setFreshKeys] = createSignal<ReadonlySet<string>>(new Set());
  // Used new chats whose session hasn't been reported yet.
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
  const cachedFresh = (p: Pick) =>
    [...clients.values()].find((c) => c.fresh?.machine === p.machine && c.fresh.harness === p.harness && c.exited === undefined);

  function show(c: Client | undefined) {
    const now = Date.now();
    for (const other of clients.values()) {
      if (other.et.visible) other.shownAt = now;
      other.et.visible = other === c;
      if (other !== c) other.et.blur();
    }
    if (c) c.shownAt = now;
    c?.et.focus();
    setView(c);
  }

  function back(flash?: string) {
    const c = view();
    // Whatever was just done in the pane (a prompt sent, an answer given) shows on the list now.
    if (c) props.store.refresh(c.session.machine);
    if (c?.fresh && c.exited === undefined) {
      setLastPick(c.fresh);
      show(undefined);
      setScreen("new");
      return;
    }
    if (c?.exited !== undefined) drop(c);
    show(undefined);
    setMount({ n: mount().n + 1, selected: c?.session.key, flash });
  }

  function drop(c: Client) {
    clients.delete(c.session.key);
    c.et.destroy();
    syncLive();
  }

  // Close pane clients that haven't been on screen for REAP_MS.
  setInterval(() => {
    const now = Date.now();
    for (const c of [...clients.values()]) {
      if (c === view() || now - c.shownAt < REAP_MS) continue;
      if (c.exited === undefined) c.proc.kill();
      drop(c);
    }
  }, 60_000).unref?.();

  function spawn(s: Session): Client {
    const m = props.store.machine(s.machine);
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
      // The dashboard's own selection (only when the harness doesn't take the mouse) is copied on release.
      onMouseUp: () => {
        if (et.hasSelection()) renderer.copyToClipboardOSC52(et.getSelectedText());
      },
    });
    host.add(et);
    const c: Client = { session: s, et, proc: undefined!, shownAt: Date.now(), tail: "", mouse: false, carry: "" };
    // Mouse drags go to the harness either way; only select here when the harness isn't handling them,
    // otherwise both draw a highlight over the same cells.
    const canSelect = et.shouldStartSelection.bind(et);
    et.shouldStartSelection = (x, y) => !c.mouse && canSelect(x, y);
    const scan = (chunk: string) => {
      const text = c.carry + chunk;
      for (const [, params, set] of text.matchAll(MOUSE_MODE))
        if (params!.split(";").some((p) => MOUSE_PARAMS.has(p))) c.mouse = set === "h";
      for (const [, b64] of text.matchAll(OSC52)) renderer.copyToClipboardOSC52(Buffer.from(b64!, "base64").toString("utf8"));
      c.carry = unfinished(text);
    };
    // Store values are proxies; Bun.spawn needs a plain array.
    const cmd = on(m, [...s.open!.cmd], { cwd: s.open!.cwd, tty: true });
    proc = Bun.spawn(cmd, {
      cwd: !m.ssh && existsSync(s.open!.cwd) ? s.open!.cwd : homedir(),
      env: { ...process.env, COLORTERM: "truecolor" },
      terminal: {
        cols,
        rows,
        data: (_t, d) => {
          et.write(d);
          const text = new TextDecoder().decode(d);
          c.tail = (c.tail + text).slice(-2000);
          scan(text);
        },
      },
    });
    c.proc = proc;
    proc.exited.then((code) => {
      c.exited = code;
      syncLive();
      // A clean exit is the CLI's own "leave"; an error stays on screen until ctrl+].
      if (code === 0) {
        if (view() === c) back();
        else drop(c);
      } else {
        const refused = m.ssh && SSH_REFUSED.test(c.tail);
        const why = refused
          ? `${m.ssh} refused another ssh session on the shared connection (sshd MaxSessions, default 10) · close some panes or raise MaxSessions`
          : `${s.open!.cmd.join(" ")}${m.ssh ? ` on ${m.id}` : ""} exited ${code}`;
        et.write(`\r\n\x1b[33m[agentdash] ${why} · ctrl+] to go back\x1b[0m\r\n`);
      }
    });
    clients.set(s.key, c);
    syncLive();
    return c;
  }

  function open(s: Session) {
    show(clients.get(s.key) ?? spawn(s));
  }

  async function pick(p: Pick, dir: string) {
    const cached = cachedFresh(p);
    if (cached) {
      setScreen("list");
      show(cached);
      return;
    }
    const known = new Set(props.store.rows(p.harness).filter((s) => s.machine === p.machine).map((s) => s.key));
    const l = await props.store.launch(p.machine, p.harness, dir);
    const placeholder: Session = {
      machine: p.machine, harness: p.harness, key: sessionKey(p.machine, p.harness, `new-${Date.now()}`), id: "", title: `new ${p.harness} session`,
      cwd: l.cwd, status: "working", detail: "", model: "", updatedAt: Date.now(), archived: false, stoppable: false, open: { cmd: l.cmd, cwd: l.cwd },
    };
    const c = spawn(placeholder);
    c.claim = { claim: l.claim, known };
    c.fresh = p;
    syncLive();
    setScreen("list");
    show(c);
  }

  createEffect(() => {
    const all = props.store.rows();
    for (const c of [...clients.values()]) {
      // Claiming an ID doesn't mean a prompt was sent. This applies to every harness.
      const reported = all.find((s) => s.key === c.session.key);
      if (c.fresh && !c.claim && reported && hasStarted(reported)) {
        c.fresh = undefined;
        syncLive();
      }
      const cl = c.claim;
      const real = cl && all.find((s) => matches(cl, c.session, s));
      if (!real) continue;
      clients.delete(c.session.key);
      c.session = real;
      c.claim = undefined;
      if (hasStarted(real)) c.fresh = undefined;
      clients.set(real.key, c);
      syncLive();
      if (view() === c) setView(c);
    }
  });

  const quit = async () => {
    // Clients only; every agent lives on in its own daemon.
    for (const c of clients.values()) c.proc.kill();
    renderer.destroy();
    await props.store.stop();
    process.exit(0);
  };

  const sessionStatus = (s: Session) => props.store.rows(s.harness).find((x) => x.key === s.key)?.status;

  useKeyboard((key) => {
    const c = view();
    if (!c) return;
    // The source confirms the first prompt; Enter may merely choose a model or dismiss a dialog.
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
          <NewSession
            store={props.store}
            initial={lastPick()}
            active={() => !view() && screen() === "new"}
            cached={(p) => !!cachedFresh(p)}
            onCancel={() => setScreen("list")}
            onPick={pick}
          />
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
              onQuit={() => void quit()}
            />
          )}
        </Show>
      </box>
      <box visible={!!view()} flexGrow={1} minHeight={0} flexDirection="column">
        <box height={1} flexShrink={0} flexDirection="row" backgroundColor={colors.surfaceRaised}>
          <text wrapMode="none" flexShrink={0} fg={providerColor(view()?.session.harness ?? "")}>{` ${view() ? label(view()!.session) : ""} `}</text>
          <text wrapMode="none" flexGrow={1} fg={colors.text} attributes={TextAttributes.BOLD}>{view()?.session.title ?? ""}</text>
          <text wrapMode="none" flexShrink={0} fg={colors.muted}>{" ctrl+] back to list "}</text>
        </box>
        <box ref={host} flexGrow={1} minHeight={0} />
      </box>
    </box>
  );
}

await render(() => <App store={store} />, { exitOnCtrlC: false, targetFps: 30 });

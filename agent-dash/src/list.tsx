// Session list across providers, modeled on paseo-tui's list: 1-cell status gutter, sort frozen
// while open so live updates change badges but never positions.
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import { Index, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { Session, Status } from "./session.ts";
import { PROVIDERS, type DashStore } from "./store.ts";
import { colors, providerColor, spinner } from "./theme.ts";
import { relTime, shortPath } from "./format.ts";

const RECENT_MS = 24 * 3600 * 1000;
const rank = (s: Status) => ({ needs: 0, error: 1, working: 2, idle: 3 })[s];
const isActive = (s: Session, now: number) => !s.archived && (s.status !== "idle" || now - s.updatedAt < RECENT_MS);

export function SessionList(props: {
  store: DashStore;
  initialSelected?: string;
  flash?: string;
  /** False while a session pane is showing; the list then ignores keys. */
  active: () => boolean;
  /** Sessions with a live embedded client. */
  live: () => ReadonlySet<string>;
  /** Unused new chats; kept out of the list. */
  hidden: () => ReadonlySet<string>;
  onOpen: (s: Session) => void;
  onNew: () => void;
  onQuit: () => void;
}) {
  const { state } = props.store;
  const [selected, setSelected] = createSignal(props.initialSelected ?? "");
  const [filter, setFilter] = createSignal("");
  const [filtering, setFiltering] = createSignal(false);
  const [showInactive, setShowInactive] = createSignal(false);
  const [flash, setFlashRaw] = createSignal(props.flash ?? "");
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  const setFlash = (m: string) => {
    setFlashRaw(m);
    clearTimeout(flashTimer);
    if (m) flashTimer = setTimeout(() => setFlashRaw(""), 4000);
  };
  if (props.flash) setFlash(props.flash);
  let scroll: ScrollBoxRenderable | undefined;

  const now = Date.now();
  const all = createMemo(() => PROVIDERS.flatMap((p) => state.sessions[p]).filter((s) => !props.hidden().has(s.key)));
  const ready = () => PROVIDERS.every((p) => state.loaded[p]);

  // Frozen once every provider has answered; until then rows sort live.
  const frozen = new Map<string, number>();
  const liveOrder = (a: Session, b: Session) => rank(a.status) - rank(b.status) || b.updatedAt - a.updatedAt;
  createEffect(() => {
    if (!ready() || frozen.size) return;
    all().slice().sort(liveOrder).forEach((s, i) => frozen.set(s.key, i));
  });

  const rows = createMemo(() => {
    const q = filter().toLowerCase();
    const matched = all().filter(
      (s) => !q || s.title.toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q) || s.provider.startsWith(q),
    );
    const active = matched.filter((s) => isActive(s, now));
    const inactive = matched.filter((s) => !isActive(s, now));
    const order = (a: Session, b: Session) =>
      frozen.size ? (frozen.get(a.key) ?? -1) - (frozen.get(b.key) ?? -1) || liveOrder(a, b) : liveOrder(a, b);
    return {
      list: [...active.sort(order), ...(showInactive() || q ? inactive.sort(order) : [])],
      activeCount: active.length,
      hiddenCount: showInactive() || q ? 0 : inactive.length,
    };
  });

  const index = createMemo(() => Math.max(0, rows().list.findIndex((s) => s.key === selected())));
  const current = () => rows().list[index()];

  createEffect(() => {
    const list = rows().list;
    if (ready() && list.length && !list.some((s) => s.key === selected())) setSelected(list[Math.min(index(), list.length - 1)]!.key);
  });
  const rowY = (i: number) => i + (i >= rows().activeCount ? 3 : 0);
  createEffect(() => {
    const y = rowY(index());
    if (!scroll) return;
    const top = scroll.scrollTop, h = scroll.viewport.height;
    if (y < top) scroll.scrollTo(Math.max(0, y - 3));
    else if (y >= top + h - 1) scroll.scrollTo(y - h + 2);
  });

  const move = (d: number) => {
    const list = rows().list;
    if (list.length) setSelected(list[Math.min(list.length - 1, Math.max(0, index() + d))]!.key);
  };

  useKeyboard((key) => {
    if (!props.active() || key.defaultPrevented) return;
    if (filtering()) {
      if (key.name === "escape") {
        setFiltering(false);
        setFilter("");
      } else if (key.name === "return") setFiltering(false);
      return;
    }
    const s = current();
    if (key.name === "up" || key.name === "k") move(key.shift ? -8 : -1);
    else if (key.name === "down" || key.name === "j") move(key.shift ? 8 : 1);
    else if ((key.name === "return" || key.name === "right" || key.name === "l") && s) {
      if (s.open) props.onOpen(s);
      else setFlash(s.closedReason ?? "can't open this session here");
    } else if (key.name === "/") {
      key.preventDefault();
      setFiltering(true);
    } else if (key.name === "n") props.onNew();
    else if (key.name === "tab") setShowInactive(!showInactive());
    else if (key.name === "r") props.store.refresh();
    else if (key.name === "escape" && filter()) setFilter("");
    else if (key.name === "q" || (key.ctrl && key.name === "c")) props.onQuit();
  });

  const counts = createMemo(() => {
    const c = { needs: 0, working: 0 };
    for (const s of all()) if (s.status === "needs" || s.status === "working") c[s.status]++;
    return c;
  });
  const errors = () => PROVIDERS.filter((p) => state.errors[p]).map((p) => `${p}: ${state.errors[p]}`).join(" · ");

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={colors.bg}>
      <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
        <text fg={colors.text} attributes={TextAttributes.BOLD}>
          agents · {counts().needs} need you · {counts().working} working
        </text>
        <text wrapMode="none" fg={errors() ? colors.error : colors.dim}>{errors() || (ready() ? "" : "loading…")}</text>
      </box>
      <scrollbox ref={scroll} flexGrow={1} minHeight={0} scrollY scrollX={false} viewportCulling contentOptions={{ flexDirection: "column" }} verticalScrollbarOptions={{ visible: false }}>
        <Index each={rows().list}>
          {(s, i) => {
            const active = () => index() === i;
            const st = () => s().status;
            const color = () =>
              st() === "needs" ? colors.permission : st() === "error" ? colors.error : st() === "working" ? colors.selected : colors.muted;
            const gutter = () =>
              st() === "working" ? spinner() : st() === "needs" ? "!" : st() === "error" ? "×" : active() ? "❯" : " ";
            return (
              <>
                <Show when={i === rows().activeCount}>
                  <box height={3} flexShrink={0} border={["top"]} borderColor={colors.border}>
                    <text fg={colors.text} attributes={TextAttributes.BOLD}>Inactive</text>
                  </box>
                </Show>
                <box height={1} flexShrink={0} flexDirection="row" backgroundColor={active() ? colors.surfaceRaised : colors.bg} onMouseDown={() => setSelected(s().key)}>
                  <box width={1} flexShrink={0}>
                    <text fg={active() && (st() === "idle") ? colors.selected : color()}>{gutter()}</text>
                  </box>
                  <box flexDirection="row" flexGrow={1} flexBasis={0} minWidth={0} overflow="hidden" paddingLeft={1}>
                    <text wrapMode="none" flexShrink={0} fg={providerColor(s().provider)}>{s().provider.padEnd(9)}</text>
                    <text wrapMode="none" flexShrink={0} fg={active() ? colors.selected : s().open ? colors.text : colors.muted} attributes={active() ? TextAttributes.BOLD : undefined}>
                      {s().title}
                    </text>
                    <Show when={s().detail}>
                      <text wrapMode="none" flexShrink={1} fg={color()}>{` · ${s().detail.split("\n")[0]}`}</text>
                    </Show>
                  </box>
                  <Show when={props.live().has(s().key)}>
                    <text wrapMode="none" flexShrink={0} fg={colors.success}> ● open</text>
                  </Show>
                  <Show when={!s().open}>
                    <text wrapMode="none" flexShrink={0} fg={colors.dim}> [view only]</text>
                  </Show>
                  <text wrapMode="none" flexShrink={0} fg={colors.dim}>{` ${s().cwd.split("/").pop()}`}</text>
                  <box width={9} flexShrink={0} justifyContent="flex-end" flexDirection="row">
                    <text wrapMode="none" fg={colors.muted}>{relTime(s().updatedAt)}</text>
                  </box>
                </box>
              </>
            );
          }}
        </Index>
      </scrollbox>
      <box height={4} flexShrink={0} flexDirection="column" border={["top"]} borderColor={current()?.status === "needs" ? colors.permission : colors.border}>
        <text height={1} wrapMode="none" fg={colors.muted}>
          {current() ? [current()!.provider, current()!.model, shortPath(current()!.cwd)].filter(Boolean).join(" · ") : ""}
        </text>
        <text height={1} wrapMode="none" fg={colors.text}>{current()?.detail.split("\n")[0] ?? ""}</text>
        <text height={1} wrapMode="none" fg={colors.dim}>
          {current() ? (current()!.open ? `⏎ ${current()!.open!.cmd.join(" ")}` : current()!.closedReason) : ""}
        </text>
      </box>
      <box height={1} flexShrink={0} flexDirection="row">
        <Show
          when={filtering()}
          fallback={
            <text fg={colors.dim} wrapMode="none">
              {flash() ? `${flash()} · ` : ""}
              {filter() ? `filter: ${filter()} · ` : ""}
              {rows().hiddenCount ? `${rows().hiddenCount} inactive (tab) · ` : ""}↑↓ move · ⏎ open · n new · / filter · r refresh · q quit · ctrl+] back from a session
            </text>
          }
        >
          <text fg={colors.selected}>/ </text>
          <input focused flexGrow={1} value={filter()} onInput={(v: string) => setFilter(v)} focusedBackgroundColor={colors.bg} backgroundColor={colors.bg} textColor={colors.text} />
        </Show>
      </box>
    </box>
  );
}

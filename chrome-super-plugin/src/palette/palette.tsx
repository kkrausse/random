import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Bookmark, BookOpen, Command, Globe, History, Lightbulb, type LucideIcon, RotateCcw, Search } from "lucide-react";
import { COMMANDS, type Mode, type PaletteCommand, type RunContext, type RunResult } from "./commands";
import { fuzzyBest } from "./fuzzy";
import { CHEAT_SHEET, SHORTCUTS, shortcutParts, shortcutText, tabNumberShortcut, type Shortcut } from "./shortcuts";
import { getSettings, getUsage, isPaletteSession, OPEN_ID_KEY, restoreLastClosed, type BackgroundMessage, type Nudge, type Settings } from "./shared";

type Group = "Tabs" | "Commands" | "Recently closed" | "Bookmarks" | "History" | "Open" | string;

interface Item {
  key: string;
  group: Group;
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  faviconFor?: string;
  shortcut?: Shortcut;
  hint?: string;
  badge?: string;
  // Usage counter key; commands rank higher the more they're used.
  usageId?: string;
  // Wording for the "Last time you ran …" hint, if not the title.
  nudgeTitle?: string;
  score: number;
  matches: number[];
  run?: (ctx: RunContext, event: { newTab: boolean }) => Promise<RunResult | void> | RunResult | void;
}

const params = new URLSearchParams(location.search);
const ORIGIN_WINDOW_ID = Number(params.get("window"));
const ORIGIN_TAB_ID = params.has("tab") ? Number(params.get("tab")) : null;

const GROUP_ORDER: Group[] = ["Open", "Tabs", "Commands", "Recently closed", "Bookmarks", "History"];
const MODE_LABEL: Record<Mode, string> = { root: "", cheatsheet: "Shortcuts", history: "History", bookmarks: "Bookmarks", url: "Open URL" };
const MODE_ICON: Record<Mode, LucideIcon> = { root: Search, cheatsheet: BookOpen, history: History, bookmarks: Bookmark, url: Globe };
const MODE_PLACEHOLDER: Record<Mode, string> = {
  root: "Search tabs, commands, bookmarks, history…",
  cheatsheet: "Search keyboard shortcuts…",
  history: "Search history…",
  bookmarks: "Search bookmarks…",
  url: "Type a URL or search terms, ↵ to open (⌘↵ new tab)"
};

function faviconUrl(pageUrl: string) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", "32");
  return url.toString();
}

function hostOf(url?: string) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol.startsWith("http") ? parsed.host + (parsed.pathname === "/" ? "" : parsed.pathname) : url;
  } catch {
    return url;
  }
}

// "example.com", "localhost:3000/x", "https://…", "chrome://flags".
function asUrl(text: string): string | null {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^(about|chrome|data|file):/i.test(t)) return t;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(t) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(t)) return `http://${t}`;
  if (/^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(t)) return `https://${t}`;
  return null;
}

async function openUrl(ctx: RunContext, url: string, newTab: boolean): Promise<RunResult> {
  if (newTab || ctx.originTabId === null) {
    await chrome.tabs.create({ url, windowId: ctx.originWindowId, active: true });
  } else {
    await chrome.tabs.update(ctx.originTabId, { url, active: true });
  }
  return {};
}

async function searchWeb(ctx: RunContext, text: string, newTab: boolean): Promise<RunResult> {
  const disposition = newTab || ctx.originTabId === null ? "NEW_TAB" : "CURRENT_TAB";
  if (disposition === "CURRENT_TAB") await chrome.search.query({ text, tabId: ctx.originTabId! });
  else await chrome.search.query({ text, disposition });
  return {};
}

function usageBoost(count: number | undefined) {
  return count ? 14 * Math.log2(1 + count) : 0;
}

function Keycaps({ shortcut, active }: { shortcut: string; active?: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {shortcutParts(shortcut).map((part, i) => part.kind === "text"
        ? <span key={i} className="px-0.5 text-[11px] text-muted">{part.text}</span>
        : (
          <span key={i} className="flex items-center gap-0.5">
            {part.keys.map((key, j) => (
              <kbd
                key={j}
                className={`inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-md border px-1.5 font-sans text-[12px] leading-none font-medium shadow-[0_1px_0_var(--keycap-shadow)] ${active ? "border-keycap-active-border bg-keycap-active text-fg" : "border-keycap-border bg-keycap text-muted"}`}
              >
                {key}
              </kbd>
            ))}
          </span>
        ))}
    </span>
  );
}

function Highlight({ text, matches }: { text: string; matches: number[] }) {
  if (!matches.length) return <>{text}</>;
  const set = new Set(matches);
  const out: ReactNode[] = [];
  let run = "";
  let runMatched = false;
  const flush = (key: number) => {
    if (!run) return;
    out.push(runMatched ? <mark key={key} className="bg-transparent font-semibold text-accent">{run}</mark> : <span key={key}>{run}</span>);
    run = "";
  };
  for (let i = 0; i < text.length; i++) {
    const matched = set.has(i);
    if (matched !== runMatched) {
      flush(i);
      runMatched = matched;
    }
    run += text[i];
  }
  flush(text.length);
  return <>{out}</>;
}

function ItemIcon({ item }: { item: Item }) {
  const [failed, setFailed] = useState(false);
  if (item.faviconFor && !failed) {
    return <img src={faviconUrl(item.faviconFor)} className="size-4 rounded-sm" onError={() => setFailed(true)} alt="" />;
  }
  const Icon = item.icon ?? Globe;
  return <Icon className="size-4" strokeWidth={1.75} />;
}

function Palette() {
  const [mode, setModeState] = useState<Mode>("root");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  const [closed, setClosed] = useState<chrome.sessions.Session[]>([]);
  const [bookmarks, setBookmarks] = useState<chrome.bookmarks.BookmarkTreeNode[]>([]);
  const [history, setHistory] = useState<chrome.history.HistoryItem[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [settings, setSettings] = useState<Settings | null>(null);
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const setMode = useCallback((next: Mode) => {
    setModeState(next);
    setQuery("");
    setSelected(0);
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    void chrome.tabs.query({ windowType: "normal" }).then(setTabs);
    void chrome.sessions.getRecentlyClosed({ maxResults: 15 }).then((all) => setClosed(all.filter((s) => !isPaletteSession(s))));
    void getUsage().then(setUsage);
    void getSettings().then(setSettings);
    void chrome.storage.local.get("pendingNudge").then(({ pendingNudge }) => {
      const pending = pendingNudge as Nudge | undefined;
      // Shown once, the next time the palette opens.
      if (pending && Date.now() - pending.at < 12 * 60 * 60 * 1000) setNudge(pending);
      if (pending) void chrome.storage.local.remove("pendingNudge");
    });
    const refocus = () => inputRef.current?.focus();
    window.addEventListener("focus", refocus);
    return () => window.removeEventListener("focus", refocus);
  }, []);

  // Bookmarks and history are looked up as you type.
  useEffect(() => {
    const q = query.trim();
    const timer = setTimeout(() => {
      if (mode === "bookmarks") {
        void (q ? chrome.bookmarks.search(q) : chrome.bookmarks.getRecent(50)).then((nodes) => setBookmarks(nodes.filter((n) => n.url).slice(0, 60)));
      } else if (mode === "history") {
        void chrome.history.search({ text: q, maxResults: 60, startTime: 0 }).then(setHistory);
      } else if (mode === "root" && q.length >= 2) {
        void chrome.bookmarks.search(q).then((nodes) => setBookmarks(nodes.filter((n) => n.url).slice(0, 20)));
        void chrome.history.search({ text: q, maxResults: 20, startTime: 0 }).then(setHistory);
      } else {
        setBookmarks([]);
        setHistory([]);
      }
    }, mode === "root" ? 60 : 0);
    return () => clearTimeout(timer);
  }, [query, mode]);

  const ctx: RunContext = useMemo(() => ({
    originTabId: ORIGIN_TAB_ID,
    originWindowId: ORIGIN_WINDOW_ID,
    query,
    setMode
  }), [query, setMode]);

  const items = useMemo(() => buildItems({ mode, query, tabs, closed, bookmarks, history, usage, ctx }), [mode, query, tabs, closed, bookmarks, history, usage, ctx]);

  useEffect(() => setSelected(0), [query, mode]);
  useEffect(() => {
    if (selected >= items.length) setSelected(Math.max(0, items.length - 1));
  }, [items.length, selected]);

  useLayoutEffect(() => {
    listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected, items]);

  function close(refocusOrigin: boolean) {
    const message: BackgroundMessage = { type: "close-palette", refocusOrigin };
    void chrome.runtime.sendMessage(message).catch(() => window.close());
  }

  async function recordUsage(item: Item) {
    if (!item.usageId) return;
    const current = await getUsage();
    const count = (current[item.usageId] ?? 0) + 1;
    const next = { ...current, [item.usageId]: count };
    const text = shortcutText(item.shortcut);
    const limit = settings?.nudgeLimit ?? 10;
    const writes: Record<string, unknown> = { usage: next };
    if (text && count <= limit) {
      writes.pendingNudge = { title: item.nudgeTitle ?? item.title, shortcut: text, count, at: Date.now() } satisfies Nudge;
    }
    await chrome.storage.local.set(writes);
    setUsage(next);
  }

  function runItem(item: Item | undefined, newTab: boolean) {
    if (!item?.run || busy) return;
    // run() is called synchronously, inside the key event's user gesture;
    // Reading Context's sidePanel.open() depends on that.
    let result: Promise<RunResult | void>;
    try {
      result = Promise.resolve(item.run(ctx, { newTab }));
    } catch (error) {
      result = Promise.reject(error);
    }
    setBusy(true);
    const usageWrite = recordUsage(item).catch(() => {});
    void result.then(async (value) => {
      const outcome = value as RunResult | undefined;
      await usageWrite;
      setBusy(false);
      if (outcome?.keepOpen) {
        if (outcome.error || outcome.message) setNotice({ text: outcome.error ?? outcome.message!, error: Boolean(outcome.error) });
        void getUsage().then(setUsage);
        inputRef.current?.focus();
        return;
      }
      close(!outcome?.focusMoved);
    }, async (error) => {
      await usageWrite;
      setBusy(false);
      setNotice({ text: String(error?.message ?? error), error: true });
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const key = event.key;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.shiftKey && key.toLowerCase() === "p") {
      event.preventDefault();
      close(true);
      return;
    }
    if (key === "Escape") {
      event.preventDefault();
      if (mode !== "root") setMode("root");
      else close(true);
      return;
    }
    if (key === "Backspace" && !query && mode !== "root") {
      event.preventDefault();
      setMode("root");
      return;
    }
    const down = key === "ArrowDown" || (event.ctrlKey && key === "n") || (key === "Tab" && !event.shiftKey);
    const up = key === "ArrowUp" || (event.ctrlKey && key === "p") || (key === "Tab" && event.shiftKey);
    if (down || up) {
      event.preventDefault();
      if (!items.length) return;
      setSelected((s) => (s + (down ? 1 : -1) + items.length) % items.length);
      return;
    }
    if (key === "PageDown" || key === "PageUp") {
      event.preventDefault();
      setSelected((s) => Math.min(items.length - 1, Math.max(0, s + (key === "PageDown" ? 8 : -8))));
      return;
    }
    if (key === "Enter") {
      event.preventDefault();
      runItem(items[selected], event.metaKey || event.ctrlKey);
    }
  }

  const ModeIcon = MODE_ICON[mode];
  const current = items[selected];
  const currentShortcut = shortcutText(current?.shortcut);
  let lastGroup: string | null = null;

  return (
    <div className="flex h-screen flex-col bg-surface text-fg">
      <div className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line px-5">
        <ModeIcon className="size-5 shrink-0 text-muted" strokeWidth={1.75} />
        {mode !== "root" && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setMode("root")}
            className="flex shrink-0 items-center gap-1 rounded-md bg-chip px-2 py-1 text-[12px] font-medium text-fg"
          >
            <ArrowLeft className="size-3" /> {MODE_LABEL[mode]}
          </button>
        )}
        <input
          ref={inputRef}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setNotice(null); }}
          onKeyDown={onKeyDown}
          placeholder={MODE_PLACEHOLDER[mode]}
          className="h-full min-w-0 flex-1 bg-transparent text-[18px] outline-none placeholder:text-placeholder"
        />
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5" role="listbox">
        {items.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-[13px] text-muted">
            <span>No results</span>
            {mode === "root" && <span className="text-[12px]">Try “cheat sheet” to browse every shortcut</span>}
          </div>
        )}
        {items.map((item, index) => {
          const showGroup = item.group !== lastGroup;
          lastGroup = item.group;
          const isSelected = index === selected;
          const text = shortcutText(item.shortcut);
          return (
            <div key={item.key}>
              {showGroup && (
                <div className="px-3 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{item.group}</div>
              )}
              <div
                data-index={index}
                role="option"
                aria-selected={isSelected}
                onMouseMove={() => selected !== index && setSelected(index)}
                onClick={(event) => runItem(item, event.metaKey || event.ctrlKey)}
                className={`flex h-10 cursor-default items-center gap-3 rounded-lg px-3 ${isSelected ? "bg-selected" : ""}`}
              >
                <span className={`flex size-6 shrink-0 items-center justify-center rounded-md ${isSelected ? "text-fg" : "text-muted"}`}>
                  <ItemIcon item={item} />
                </span>
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="truncate text-[14px]"><Highlight text={item.title} matches={item.matches} /></span>
                  {item.subtitle && <span className="truncate text-[12px] text-muted">{item.subtitle}</span>}
                </span>
                {item.badge && <span className="shrink-0 rounded bg-chip px-1.5 py-0.5 text-[10px] font-medium text-muted uppercase">{item.badge}</span>}
                {text && <Keycaps shortcut={text} active={isSelected} />}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex h-10 shrink-0 items-center gap-3 border-t border-line bg-footer px-4 text-[12px] text-muted">
        <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
          {notice ? (
            <span className={notice.error ? "truncate text-danger" : "truncate text-fg"}>{notice.text}</span>
          ) : mode === "cheatsheet" && current?.hint ? (
            <span className="truncate">{current.hint}</span>
          ) : nudge ? (
            <>
              <Lightbulb className="size-3.5 shrink-0 text-accent" />
              <span className="truncate">Last time you ran <span className="text-fg">{nudge.title}</span>. Next time:</span>
              <Keycaps shortcut={nudge.shortcut} active />
            </>
          ) : current?.hint ? (
            <span className="truncate">{current.hint}</span>
          ) : currentShortcut && mode === "root" ? (
            <>
              <span className="truncate">Without the palette:</span>
              <Keycaps shortcut={currentShortcut} />
            </>
          ) : (
            <span className="flex items-center gap-1.5"><Command className="size-3.5" /> Command palette</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="flex items-center gap-1.5"><Keycaps shortcut="↑ ↓" /> move</span>
          {current?.run && <span className="flex items-center gap-1.5"><Keycaps shortcut="↵" /> run</span>}
          <span className="flex items-center gap-1.5"><Keycaps shortcut="Esc" /> {mode === "root" ? "close" : "back"}</span>
        </span>
      </div>
    </div>
  );
}

interface BuildInput {
  mode: Mode;
  query: string;
  tabs: chrome.tabs.Tab[];
  closed: chrome.sessions.Session[];
  bookmarks: chrome.bookmarks.BookmarkTreeNode[];
  history: chrome.history.HistoryItem[];
  usage: Record<string, number>;
  ctx: RunContext;
}

function commandItem(command: PaletteCommand): Omit<Item, "score" | "matches"> {
  return {
    key: `cmd:${command.id}`,
    group: "Commands",
    title: command.title,
    subtitle: command.section,
    icon: command.icon,
    shortcut: command.shortcut,
    usageId: command.id,
    run: (ctx) => command.run(ctx)
  };
}

function tabItems(tabs: chrome.tabs.Tab[]): Omit<Item, "score" | "matches">[] {
  const originTabs = tabs.filter((t) => t.windowId === ORIGIN_WINDOW_ID).sort((a, b) => a.index - b.index);
  const others = tabs.filter((t) => t.windowId !== ORIGIN_WINDOW_ID);
  return [...originTabs, ...others].map((tab) => {
    const inOrigin = tab.windowId === ORIGIN_WINDOW_ID;
    const shortcut = inOrigin ? tabNumberShortcut(tab.index, tab.index === originTabs.length - 1) : undefined;
    return {
      key: `tab:${tab.id}`,
      group: "Tabs",
      title: tab.title || tab.url || "Untitled",
      subtitle: hostOf(tab.url),
      faviconFor: tab.url,
      shortcut,
      badge: tab.id === ORIGIN_TAB_ID ? "current" : inOrigin ? undefined : "other window",
      usageId: shortcut ? "switch-tab" : undefined,
      nudgeTitle: shortcut ? `Switch to tab ${tab.index + 1}` : undefined,
      run: async () => {
        await chrome.tabs.update(tab.id!, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        return { focusMoved: !inOrigin };
      }
    };
  });
}

function closedItems(closed: chrome.sessions.Session[]): Omit<Item, "score" | "matches">[] {
  return closed.flatMap((session, index) => {
    const tab = session.tab;
    const win = session.window;
    const id = tab?.sessionId ?? win?.sessionId;
    if (!id) return [];
    return [{
      key: `closed:${id}`,
      group: "Recently closed",
      title: tab ? tab.title || tab.url || "Closed tab" : `Window with ${win?.tabs?.length ?? 0} tabs`,
      subtitle: tab ? hostOf(tab.url) : "window",
      faviconFor: tab?.url,
      icon: RotateCcw,
      shortcut: index === 0 ? SHORTCUTS.reopenClosed : undefined,
      usageId: index === 0 ? "reopen-closed" : undefined,
      nudgeTitle: "Reopen closed tab",
      run: async () => { await chrome.sessions.restore(id); return { focusMoved: true }; }
    }];
  });
}

function linkItem(group: Group, key: string, title: string, url: string, subtitle?: string): Omit<Item, "score" | "matches"> {
  return {
    key,
    group,
    title: title || url,
    subtitle: subtitle ?? hostOf(url),
    faviconFor: url,
    run: (ctx, { newTab }) => openUrl(ctx, url, newTab)
  };
}

function scored(base: Omit<Item, "score" | "matches">, query: string, extra: (string | undefined)[], boost = 0): Item | null {
  if (!query.trim()) return { ...base, score: boost, matches: [] };
  const result = fuzzyBest(query, [base.title, ...extra]);
  if (!result) return null;
  return { ...base, score: result.score + boost, matches: result.matches };
}

function byScore(items: (Item | null)[], limit: number) {
  return (items.filter(Boolean) as Item[]).sort((a, b) => b.score - a.score).slice(0, limit);
}

function buildItems({ mode, query, tabs, closed, bookmarks, history, usage, ctx }: BuildInput): Item[] {
  const q = query.trim();

  if (mode === "cheatsheet") {
    const entries = CHEAT_SHEET.map((entry) => scored({
      key: `cheat:${entry.id}`,
      group: entry.section,
      title: entry.title,
      shortcut: entry.shortcut,
      hint: entry.hint,
      icon: Command
    }, q, [entry.keywords, entry.section, entry.shortcut.mac]));
    const kept = entries.filter(Boolean) as Item[];
    if (!q) return kept;
    // Keep sections together, ordered by their best match.
    const best = new Map<string, number>();
    for (const item of kept) best.set(item.group, Math.max(best.get(item.group) ?? -Infinity, item.score));
    return kept.sort((a, b) => (best.get(b.group)! - best.get(a.group)!) || b.score - a.score);
  }

  if (mode === "url") {
    if (!q) return [];
    const url = asUrl(q);
    const items: Item[] = [];
    if (url) items.push({ ...linkItem("Open", "url:open", `Open ${url}`, url, ""), icon: Globe, faviconFor: undefined, score: 0, matches: [] });
    items.push({
      key: "url:search", group: "Open", title: `Search the web for “${q}”`, icon: Search, score: 0, matches: [],
      run: (c, { newTab }) => searchWeb(c, q, newTab)
    });
    return items;
  }

  if (mode === "history") {
    return history.map((h, i) => ({
      ...linkItem("History", `history:${h.id}`, h.title || h.url!, h.url!, `${hostOf(h.url)}${h.lastVisitTime ? ` · ${new Date(h.lastVisitTime).toLocaleDateString()}` : ""}`),
      score: -i,
      matches: []
    }));
  }

  if (mode === "bookmarks") {
    return bookmarks.map((b, i) => ({ ...linkItem("Bookmarks", `bookmark:${b.id}`, b.title, b.url!), icon: Bookmark, score: -i, matches: [] }));
  }

  // Root: one list grouped by type.
  const groups = new Map<Group, Item[]>();
  const available = COMMANDS;

  if (!q) {
    const recent = [...tabs].sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
    const ids = new Set(recent.filter((t) => t.id !== ORIGIN_TAB_ID).slice(0, 5).map((t) => t.id));
    groups.set("Tabs", tabItems(tabs).filter((t) => ids.has(Number(t.key.slice(4)))).map((t) => ({ ...t, score: 0, matches: [] })));
    groups.set("Commands", available
      .map((c, i) => ({ ...commandItem(c), score: usageBoost(usage[c.id]) - i * 0.01, matches: [] }))
      .sort((a, b) => b.score - a.score));
    groups.set("Recently closed", closedItems(closed).slice(0, 3).map((c) => ({ ...c, score: 0, matches: [] })));
  } else {
    const url = asUrl(q);
    const open: Item[] = [];
    if (url) open.push({ ...linkItem("Open", "open:url", `Open ${url}`, url, ""), icon: Globe, faviconFor: undefined, shortcut: SHORTCUTS.addressBar, usageId: "open-url", score: 1000, matches: [] });
    groups.set("Open", open);
    groups.set("Tabs", byScore(tabItems(tabs).map((t) => scored(t, q, [t.subtitle])), 6));
    const commands = byScore(available.map((c) => scored(commandItem(c), q, [c.keywords, c.section], usageBoost(usage[c.id]))), 8);
    // Typed text that matches nothing well can always be searched for.
    commands.push({
      key: "search-web", group: "Commands", title: `Search the web for “${q}”`, icon: Search, shortcut: SHORTCUTS.searchWeb,
      usageId: "search-web", score: 0, matches: [],
      run: (c, { newTab }) => searchWeb(c, q, newTab)
    });
    groups.set("Commands", commands);
    groups.set("Recently closed", byScore(closedItems(closed).map((c) => scored(c, q, [c.subtitle])), 3));
    const tabUrls = new Set(tabs.map((t) => t.url));
    groups.set("Bookmarks", byScore(bookmarks.filter((b) => !tabUrls.has(b.url)).map((b) => scored({ ...linkItem("Bookmarks", `bookmark:${b.id}`, b.title, b.url!), icon: Bookmark }, q, [b.url])), 5));
    groups.set("History", byScore(history.filter((h) => !tabUrls.has(h.url)).map((h) => scored(linkItem("History", `history:${h.id}`, h.title || h.url!, h.url!), q, [h.url])), 5));
  }

  let order = GROUP_ORDER;
  if (q) {
    // Groups follow the type order, except a group whose best hit clearly
    // beats the rest moves up (typing "close tab" puts Commands first).
    const best = (g: Group) => Math.max(...(groups.get(g) ?? []).map((i) => i.score), -Infinity);
    order = [...GROUP_ORDER].sort((a, b) => {
      if (a === "Open") return -1;
      if (b === "Open") return 1;
      const diff = best(b) - best(a);
      return Math.abs(diff) > 15 ? diff : GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b);
    });
  }
  return order.flatMap((g) => groups.get(g) ?? []);
}

// A palette window brought back by ⌘⇧T (or "Reopen closed tab") isn't one
// the background opened: pass the restore on to the real closed tab and go.
async function start() {
  const stored = await chrome.storage.session.get(OPEN_ID_KEY);
  if (!params.get("open") || stored[OPEN_ID_KEY] !== params.get("open")) {
    await restoreLastClosed().catch(() => {});
    window.close();
    return;
  }
  createRoot(document.getElementById("root")!).render(<Palette />);
}

void start();

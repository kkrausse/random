import { FitAddon, init, Terminal, type ITheme } from "../vendor/ghostty-web/lib/index";
import { TerminalConnection } from "./connection";
import { installScrolling } from "./scroll";
import { installMobileControls } from "./mobile";

type Session = {
  id: string;
  name: string;
  title: string;
  status: "running" | "exited";
  clients: number;
  createdAt: string;
  exitCode: number | null;
};

type LocalTheme = {
  terminal: ITheme;
  fontFamily: string;
  fontSize: number;
  scrollSensitivity?: number;
};

const sessionList = document.querySelector<HTMLElement>("#session-list");

if (sessionList) {
  void startSessionsPage(sessionList);
} else {
  void startTerminalPage();
}

async function startSessionsPage(list: HTMLElement) {
  const theme = await getTheme();
  applyPageTheme(theme);
  setFavicon("terminal");

  async function refresh() {
    const response = await fetch("/api/sessions", { cache: "no-store" });
    const sessions = (await response.json()) as Session[];
    renderSessions(list, sessions);
  }

  list.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-delete]");
    if (!button) return;
    event.preventDefault();
    await fetch(`/api/sessions/${button.dataset.delete}`, { method: "DELETE" });
    await refresh();
  });

  await refresh();
  window.setInterval(refresh, 2000);
}

function renderSessions(container: HTMLElement, sessions: Session[]) {
  if (sessions.length === 0) {
    container.innerHTML = `<div class="empty"><span>No sessions yet.</span><small>Start a shell and it will stay open when you leave.</small></div>`;
    return;
  }

  container.innerHTML = sessions
    .map((session) => {
      const detail = session.status === "running"
        ? `${session.clients} ${session.clients === 1 ? "connection" : "connections"}`
        : `exited${session.exitCode === null ? "" : ` ${session.exitCode}`}`;
      return `<a class="session" href="/terminal/${session.id}">
        <span class="session-icon" aria-hidden="true">${iconSvg(iconKind(session.title || session.name))}<span class="status ${session.status}"></span></span>
        <span class="session-main"><strong>${escapeHtml(session.name)}</strong><small>${detail} · ${relativeTime(session.createdAt)}</small></span>
        <span class="open-label">Open</span>
        <button class="delete" data-delete="${session.id}" aria-label="Remove ${escapeHtml(session.name)}">×</button>
      </a>`;
    })
    .join("");
}

async function startTerminalPage() {
  const container = document.querySelector<HTMLElement>("#terminal");
  if (!container) return;

  const id = location.pathname.split("/").filter(Boolean).at(-1);
  const theme = await getTheme();
  applyPageTheme(theme);
  setFavicon("shell");
  await init();

  const copyToast = document.querySelector<HTMLElement>("#copy-toast");
  let copyToastTimer: ReturnType<typeof setTimeout> | undefined;
  const terminal = new Terminal({
    cursorBlink: true,
    fontFamily: theme.fontFamily,
    fontSize: theme.fontSize,
    scrollback: 10_000,
    selectOnDrag: false, // Updated from tmux's inner application mouse mode below.
    copyOnSelect: false, // Set true to copy automatically when highlighting text.
    onClipboardWrite(success) {
      if (!copyToast) return;
      clearTimeout(copyToastTimer);
      copyToast.dataset.status = success ? "success" : "error";
      copyToast.textContent = success ? "Copied" : "Copy failed · Try again";
      copyToastTimer = setTimeout(() => { copyToast.textContent = ""; }, success ? 1800 : 4000);
    },
    smoothScrollDuration: 0,
    theme: theme.terminal,
    rendererType: "webgl",
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  await terminal.open(container);
  const rendererName = terminal.renderer?.constructor.name;
  if (rendererName !== "WebglRenderer") {
    terminal.dispose();
    container.classList.add("renderer-error");
    container.textContent = "WebGL2 is unavailable. The terminal requires the ghostty-web WebGL renderer.";
    throw new Error(`Expected WebglRenderer, got ${rendererName ?? "no renderer"}`);
  }
  container.dataset.renderer = "webgl";
  fit.fit();
  terminal.focus();
  terminal.onTitleChange(updateTitle);
  // Ctrl+Tab / Ctrl+Shift+Tab switch browser tabs. The emulator would encode
  // these and preventDefault them, so stop them at window capture before they
  // reach the terminal and let the browser handle them.
  window.addEventListener("keydown", (event) => {
    if (event.code === "Tab" && event.ctrlKey && !event.altKey && !event.metaKey) {
      event.stopImmediatePropagation();
    }
  }, { capture: true });
  installScrolling(container, () => ({
    lineHeight: terminal.renderer?.getMetrics().height ?? 20,
    rows: terminal.rows,
    mode: terminal.wasmTerm?.hasMouseTracking() ? "mouse" : terminal.wasmTerm?.isAlternateScreen() ? "alternate" : "history",
  }), theme.scrollSensitivity ?? 0.5);

  container.addEventListener("paste", (event) => {
    const images = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void pasteImages(images);
  }, { capture: true });

  const connectionStatus = document.querySelector<HTMLButtonElement>("#connection-status");
  let titleBuffer = "";
  const titleDecoder = new TextDecoder();
  const connection = new TerminalConnection(id!, {
    size: () => ({ cols: terminal.cols, rows: terminal.rows }),
    reset() {
      terminal.options.selectOnDrag = false;
      titleBuffer = "";
      titleDecoder.decode();
      terminal.scrollToBottom();
      terminal.write("\x1bc");
    },
    write(data) {
      inspectTitles(titleDecoder.decode(data, { stream: true }));
      terminal.write(data);
    },
    mouseMode(tracking) {
      terminal.options.selectOnDrag = !tracking;
    },
    status(status) {
      if (!connectionStatus) return;
      connectionStatus.dataset.status = status;
      connectionStatus.textContent = {
        connecting: "Connecting...", connected: "Connected", reconnecting: "Reconnecting...",
        offline: "Offline", detached: "Active in another tab · Take over", closed: "Disconnected · Reattach",
      }[status];
    },
  });
  const mobile = installMobileControls(container, terminal, (message) => {
    if (!copyToast) return;
    clearTimeout(copyToastTimer);
    copyToast.dataset.status = "success";
    copyToast.textContent = message;
    copyToastTimer = setTimeout(() => { copyToast.textContent = ""; }, 3000);
  });
  terminal.onData((data) => connection.input(mobile.input(data)));
  terminal.onResize(() => connection.resize());
  // Ctrl+V belongs to the terminal (e.g. Emacs scroll-down); paste remains Cmd+V
  // on macOS and Ctrl+Shift+V elsewhere.
  container.addEventListener("keydown", (event) => {
    if (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && event.code === "KeyV") {
      event.preventDefault();
      event.stopImmediatePropagation();
      connection.input("\x16");
    }
  }, { capture: true });
  let layoutTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleLayout() {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => {
      if (document.hidden) return;
      const size = fit.proposeDimensions();
      if (size) terminal.resize(Math.max(2, Math.min(500, size.cols)), Math.max(2, Math.min(300, size.rows)));
    }, 150);
  }
  const observer = new ResizeObserver(scheduleLayout);
  observer.observe(container);
  connectionStatus?.addEventListener("click", () => connection.refresh());
  window.addEventListener("online", () => connection.restore());
  window.addEventListener("pageshow", (event) => {
    observer.observe(container);
    scheduleLayout();
    if (event.persisted) connection.refresh();
    else connection.restore();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { scheduleLayout(); connection.restore(); }
  });
  void document.fonts?.ready.then(scheduleLayout);
  window.addEventListener("pagehide", () => {
    clearTimeout(copyToastTimer);
    if (copyToast) copyToast.textContent = "";
    connection.suspend();
    observer.disconnect();
    clearTimeout(layoutTimer);
  });

  async function pasteImages(images: File[]) {
    try {
      const paths = await Promise.all(images.map(async (image) => {
        const response = await fetch(`/api/sessions/${id}/attachments`, {
          method: "POST",
          headers: { "content-type": image.type || "application/octet-stream" },
          body: image,
        });
        if (!response.ok) throw new Error(await response.text());
        return ((await response.json()) as { path: string }).path;
      }));
      terminal.paste(paths.join(" "));
    } catch (error) {
      terminal.write(`\r\n\x1b[38;2;204;102;102m[image paste failed: ${error instanceof Error ? error.message : String(error)}]\x1b[0m\r\n`);
    }
  }

  function inspectTitles(data: string) {
    titleBuffer += data;
    while (true) {
      const start = titleBuffer.indexOf("\x1b]");
      if (start === -1) {
        titleBuffer = titleBuffer.endsWith("\x1b") ? "\x1b" : "";
        return;
      }

      const bell = titleBuffer.indexOf("\x07", start + 2);
      const stringTerminator = titleBuffer.indexOf("\x1b\\", start + 2);
      const end = bell === -1 ? stringTerminator : stringTerminator === -1 ? bell : Math.min(bell, stringTerminator);
      if (end === -1) {
        titleBuffer = titleBuffer.length - start <= 8192 ? titleBuffer.slice(start) : "";
        return;
      }

      const separator = titleBuffer.indexOf(";", start + 2);
      if (separator !== -1 && separator < end) {
        const command = titleBuffer.slice(start + 2, separator);
        if (command === "0" || command === "2") updateTitle(titleBuffer.slice(separator + 1, end));
      }
      titleBuffer = titleBuffer.slice(end + (end === stringTerminator ? 2 : 1));
    }
  }

  function updateTitle(title: string) {
    document.title = title;
    const kind = iconKind(title);
    setFavicon(kind === "terminal" ? "shell" : kind);
  }
}

async function getTheme(): Promise<LocalTheme> {
  const response = await fetch("/api/theme");
  if (!response.ok) throw new Error("Could not load terminal theme");
  return response.json() as Promise<LocalTheme>;
}

function applyPageTheme(theme: LocalTheme) {
  const root = document.documentElement;
  root.style.setProperty("--background", theme.terminal.background ?? "#282c34");
  root.style.setProperty("--foreground", theme.terminal.foreground ?? "#ffffff");
  root.style.setProperty("--accent", theme.terminal.green ?? "#b5bd68");
  root.style.setProperty("--muted", theme.terminal.brightBlack ?? "#666666");
  root.style.setProperty("--danger", theme.terminal.red ?? "#cc6666");
  root.style.setProperty("--terminal-font", theme.fontFamily);
}

type IconKind = "terminal" | "shell" | "code" | "editor" | "server" | "remote";

function iconKind(title: string): IconKind {
  const value = title.toLowerCase();
  if (/\b(opencode|code|codex)\b/.test(value)) return "code";
  if (/\b(n?vim|nano|emacs|helix|zed)\b/.test(value)) return "editor";
  if (/\b(ssh|mosh|remote)\b/.test(value)) return "remote";
  if (/\b(bun|node|deno|npm|pnpm|yarn|vite|webpack|next\.js|dev server)\b/.test(value) || /https?:\/\//.test(value)) return "server";
  return "terminal";
}

function iconSvg(kind: IconKind) {
  return `<svg class="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconBody(kind)}</svg>`;
}

function iconBody(kind: IconKind) {
  if (kind === "code") return `<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 8h18M9 12l-2 2 2 2m6-4 2 2-2 2"/>`;
  if (kind === "editor") return `<path d="M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m13 15 1-4 4.6-4.6a1.4 1.4 0 0 0-2-2L12 9l-1 4 2 2Z"/>`;
  if (kind === "server") return `<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/>`;
  if (kind === "remote") return `<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4M8 9l2 2-2 2m5 0h3"/>`;
  if (kind === "shell") return `<text x="4.5" y="17.5" font-size="13" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-weight="600" fill="currentColor" stroke="none">$_</text>`;
  return `<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/>`;
}

function setFavicon(kind: IconKind) {
  const link = document.querySelector<HTMLLinkElement>("#favicon");
  if (!link) return;
  const styles = getComputedStyle(document.documentElement);
  const background = styles.getPropertyValue("--background").trim() || "#282c34";
  const accent = styles.getPropertyValue("--accent").trim() || "#b5bd68";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="${background}"/><g fill="none" stroke="${accent}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconBody(kind).replaceAll("currentColor", accent)}</g></svg>`;
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

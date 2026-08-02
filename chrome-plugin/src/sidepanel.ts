import { OpenCodeClient } from "./api";
import type { SessionEvent, SessionUsage } from "./api";
import MarkdownIt from "markdown-it";
import {
  DEFAULT_SETTINGS,
  buildHighlightPrompt,
  buildPrompt,
  readingPromptFromText
} from "./common";
import type { Capture, Message, PromptPreset, Settings } from "./common";
import { clearDiagnostics, readDiagnostics, recordDiagnostic } from "./diagnostics";

function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI element: ${selector}`);
  return element;
}

const app = $<HTMLElement>("#app");
const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true });
const AUTO_SCROLL_PAUSE_MS = 5000;
let settings: Settings;
let capture: Capture | null;
let editingPresets: PromptPreset[] = [];
let currentSessionId: string | null = null;
let currentTabId: number | null = null;
let eventStreamAbort: AbortController | null = null;
let eventStreamGeneration = 0;
let eventReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let eventStreamReady: Promise<void> = Promise.resolve();
let streamingMessageId: string | null = null;
let streamingText = "";
let streamRenderFrame: number | null = null;
let awaitingResponse = false;
let sending = false;
let stateLoaded = false;
let activeScreen: "capture" | "sessions" | "chat" | "settings" = "capture";
let lastUserScrollAt = 0;
let lastRenderedMessageState = "";
let autoScrollFrame: number | null = null;
let chatPinnedToBottom = true;
const queuedCaptures = new Map<number, Capture>();

markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet("target", "_blank");
  tokens[index].attrSet("rel", "noopener noreferrer");
  return renderer.renderToken(tokens, index, options);
};

function recordScrollInput() {
  if (activeScreen !== "chat") return;
  lastUserScrollAt = Date.now();
  chatPinnedToBottom = isChatAtBottom();
  if (autoScrollFrame !== null) cancelAnimationFrame(autoScrollFrame);
  autoScrollFrame = null;
}

document.addEventListener("wheel", recordScrollInput, { passive: true });
document.addEventListener("touchmove", recordScrollInput, { passive: true });
document.addEventListener("scroll", () => {
  if (activeScreen !== "chat") return;
  chatPinnedToBottom = isChatAtBottom();
  if (chatPinnedToBottom) lastUserScrollAt = 0;
}, { passive: true });
document.addEventListener("pointerdown", (event) => {
  if (event.clientX >= window.innerWidth - 20) recordScrollInput();
});
document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement
    || event.target instanceof HTMLTextAreaElement
    || event.target instanceof HTMLSelectElement) return;
  if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
    recordScrollInput();
  }
});

function isChatAtBottom() {
  const root = document.scrollingElement || document.documentElement;
  return root.scrollHeight - root.scrollTop - root.clientHeight <= 24;
}

function scrollChatToBottom() {
  if (activeScreen !== "chat"
    || (!chatPinnedToBottom && Date.now() - lastUserScrollAt < AUTO_SCROLL_PAUSE_MS)) return;
  if (autoScrollFrame !== null) cancelAnimationFrame(autoScrollFrame);
  autoScrollFrame = requestAnimationFrame(() => {
    autoScrollFrame = null;
    if (activeScreen === "chat"
      && (chatPinnedToBottom || Date.now() - lastUserScrollAt >= AUTO_SCROLL_PAUSE_MS)) {
      chatPinnedToBottom = true;
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" });
    }
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session") return;
  for (const [key, change] of Object.entries(changes)) {
    if (!key.startsWith("pendingCapture:") || !change.newValue) continue;
    const tabId = Number(key.slice("pendingCapture:".length));
    const nextCapture = change.newValue as Capture;
    if (!stateLoaded) {
      queuedCaptures.set(tabId, nextCapture);
      continue;
    }
    currentTabId = tabId;
    capture = nextCapture;
    chrome.storage.session.remove(key);
    if (activeScreen === "chat" && currentSessionId) {
      renderChatCapture();
    } else {
      showCapture();
    }
  }
});

async function loadState() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id ?? null;
  const captureKey = currentTabId === null ? null : `pendingCapture:${currentTabId}`;
  const stored = await chrome.storage.local.get("settings") as {
    settings?: Partial<Settings>;
  };
  const pending = captureKey
    ? await chrome.storage.session.get(captureKey) as Record<string, Capture>
    : {};
  settings = {
    ...DEFAULT_SETTINGS,
    ...(stored.settings || {}),
    promptPresets: stored.settings?.promptPresets || DEFAULT_SETTINGS.promptPresets
  };
  capture = currentTabId === null
    ? null
    : queuedCaptures.get(currentTabId) || (captureKey ? pending[captureKey] : null) || null;
  if (currentTabId !== null) queuedCaptures.delete(currentTabId);
  if (captureKey && capture) await chrome.storage.session.remove(captureKey);
  stateLoaded = true;
}

function client() {
  return new OpenCodeClient(settings);
}

function escapeHtml(value: unknown): string {
  const element = document.createElement("div");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

function setStatus(text: string) {
  const status = document.querySelector<HTMLElement>(".status");
  if (status) status.textContent = text;
}

function stopChatUpdates() {
  eventStreamGeneration++;
  eventStreamAbort?.abort();
  eventStreamAbort = null;
  eventStreamReady = Promise.resolve();
  clearTimeout(eventReconnectTimer);
  eventReconnectTimer = null;
  if (streamRenderFrame !== null) cancelAnimationFrame(streamRenderFrame);
  streamRenderFrame = null;
  streamingMessageId = null;
  streamingText = "";
  awaitingResponse = false;
  sending = false;
}

function setComposerEnabled(enabled: boolean) {
  const input = document.querySelector<HTMLTextAreaElement>("#reply");
  const button = document.querySelector<HTMLButtonElement>("#send-reply");
  if (input) input.disabled = !enabled;
  if (button) button.disabled = !enabled;
  document.querySelectorAll<HTMLInputElement | HTMLButtonElement>(".append-control")
    .forEach((control) => control.disabled = !enabled);
}

function heading(title: string, subtitle: string) {
  return `<h1>${escapeHtml(title)}</h1><p class="subtitle">${escapeHtml(subtitle)}</p>`;
}

function setCaptureControlsEnabled(enabled: boolean) {
  app.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>("button, textarea")
    .forEach((control) => control.disabled = !enabled);
}

async function showCapture() {
  activeScreen = "capture";
  stopChatUpdates();
  currentSessionId = null;
  if (!capture) {
    app.innerHTML = heading("Reading Context", "Select a passage on any page to begin.")
      + `<div class="empty">Highlight text, then press the Explain button beside the selection.</div>`
      + `<button class="secondary" data-screen="sessions">Browse shared chats</button>`;
    bindScreenButtons();
    return;
  }

  app.innerHTML = heading("Ask the page", capture.pageTitle || "Selected passage") + `
    <div class="eyebrow">Highlight</div>
    <section class="context-card"><blockquote>${escapeHtml(capture.highlight)}</blockquote></section>
    <div class="eyebrow">Page context</div>
    <section class="context-card context-preview">${escapeHtml(capture.surroundingContext)}</section>
    <div class="eyebrow">Quick questions</div>
    <div class="button-grid" id="presets"></div>
    <label><span>Your question</span><textarea id="question" placeholder="What do you want to understand?"></textarea></label>
    <button class="primary" id="start-chat">Start chat</button>
    <p class="status"></p>`;
  const presets = $<HTMLElement>("#presets");
  settings.promptPresets.forEach((preset) => {
    const button = document.createElement("button");
    button.className = "primary";
    button.textContent = preset.label;
    button.addEventListener("click", () => startChat(preset.prompt));
    presets.append(button);
  });
  $("#start-chat").addEventListener("click", () => {
    const question = $<HTMLTextAreaElement>("#question").value.trim();
    if (question) startChat(question);
  });
}

async function startChat(question: string) {
  setStatus("Starting chat...");
  setCaptureControlsEnabled(false);
  try {
    const api = client();
    const prompt = buildPrompt(settings.messageTemplate, capture, question);
    const sessionId = await api.createSession(settings);
    if (activeScreen === "capture") await showChat(sessionId, true);
    await api.sendMessage(sessionId, prompt);
    if (currentSessionId === sessionId) await refreshMessages(true);
  } catch (error) {
    if (activeScreen === "capture" || activeScreen === "chat") {
      setCaptureControlsEnabled(true);
      setComposerEnabled(true);
      setStatus(error.message);
    }
  }
}

function renderMessageText(message: Message, container: HTMLElement) {
  if (message.role === "OpenCode") {
    container.className = "message-content markdown-body";
    container.innerHTML = message.text
      ? markdown.render(message.text)
      : `<p class="thinking">Thinking...</p>`;
    return;
  }

  const prompt = readingPromptFromText(message.text);
  if (!prompt) {
    container.className = "message-content plain-message";
    container.textContent = message.text;
    return;
  }

  container.className = "message-content reading-prompt";
  if (prompt.question) {
    const question = document.createElement("p");
    question.className = "prompt-question";
    question.textContent = prompt.question;
    container.append(question);
  }
  if (prompt.highlight) {
    const highlight = document.createElement("blockquote");
    highlight.textContent = prompt.highlight;
    container.append(highlight);
  }
  if (prompt.surroundingContext || prompt.pageTitle || prompt.pageUrl) {
    const details = document.createElement("details");
    details.className = "prompt-context";
    const summary = document.createElement("summary");
    summary.textContent = "View page context";
    details.append(summary);
    if (prompt.pageTitle || prompt.pageUrl) {
      const source = document.createElement("p");
      source.className = "prompt-source";
      source.textContent = [prompt.pageTitle, prompt.pageUrl].filter(Boolean).join("\n");
      details.append(source);
    }
    if (prompt.surroundingContext) {
      const context = document.createElement("div");
      context.className = "prompt-context-text";
      context.textContent = prompt.surroundingContext;
      details.append(context);
    }
    container.append(details);
  }
}

async function showSessions() {
  activeScreen = "sessions";
  stopChatUpdates();
  currentSessionId = null;
  app.innerHTML = heading("Shared chats", "Conversations from Chrome and Palma.")
    + `<p class="status">Loading...</p><div id="sessions"></div>`;
  try {
    const sessions = await client().sessions();
    if (activeScreen !== "sessions") return;
    setStatus(sessions.length ? "" : "No chats yet.");
    const list = $<HTMLElement>("#sessions");
    sessions.forEach((session) => {
      const button = document.createElement("button");
      button.className = "session";
      const updated = session.time?.updated
        ? new Date(session.time.updated).toLocaleString() : "Unknown date";
      button.innerHTML = `<strong>${escapeHtml(session.title || "Untitled reading chat")}</strong>`
        + `<time>${escapeHtml(updated)}</time>`;
      button.addEventListener("click", () => showChat(session.id));
      list.append(button);
    });
  } catch (error) {
    if (activeScreen === "sessions") setStatus(error.message);
  }
}

async function showChat(sessionId: string, preparingPrompt = false) {
  activeScreen = "chat";
  lastUserScrollAt = 0;
  lastRenderedMessageState = "";
  chatPinnedToBottom = true;
  stopChatUpdates();
  currentSessionId = sessionId;
  app.innerHTML = heading("Conversation", "Reading notes, kept on your OpenCode server.") + `
    <div id="messages"></div>
    <div id="chat-capture"></div>
    <footer class="chat-usage" id="chat-usage">Usage loading...</footer>
    <p class="status">Loading...</p>
    <div class="composer">
      <textarea id="reply" placeholder="Continue the conversation..."></textarea>
      <button class="primary" id="send-reply">Send</button>
    </div>`;
  $("#send-reply").addEventListener("click", sendReply);
  $<HTMLTextAreaElement>("#reply").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) sendReply();
  });
  eventStreamReady = startEventStream(sessionId);
  if (preparingPrompt) {
    setComposerEnabled(false);
    setStatus("Sending page context...");
    await waitForEventStream();
  } else {
    await refreshMessages(false);
  }
}

function renderChatCapture() {
  const container = document.querySelector<HTMLElement>("#chat-capture");
  if (!container || !capture || !currentSessionId) return;
  container.innerHTML = `<section class="chat-capture-card">
    <div class="eyebrow">New highlight</div>
    <blockquote>${escapeHtml(capture.highlight)}</blockquote>
    <p class="help">Ask about only this highlight in the current conversation.</p>
    <div class="button-grid chat-capture-presets"></div>
    <label><span>Your question</span><textarea class="append-control" id="append-question" placeholder="What do you want to understand?"></textarea></label>
    <button class="primary append-control" id="append-highlight">Append to this chat</button>
    <button class="secondary new-chat-action" id="new-chat-from-capture">Start new chat with page context</button>
  </section>`;
  const presets = $<HTMLElement>(".chat-capture-presets", container);
  settings.promptPresets.forEach((preset) => {
    const button = document.createElement("button");
    button.className = "primary append-control";
    button.textContent = preset.label;
    button.addEventListener("click", () => appendHighlight(preset.prompt));
    presets.append(button);
  });
  $("#append-highlight", container).addEventListener("click", () => {
    const question = $<HTMLTextAreaElement>("#append-question", container).value.trim();
    if (question) appendHighlight(question);
  });
  $("#new-chat-from-capture", container).addEventListener("click", () => showCapture());
  setComposerEnabled(!sending && !awaitingResponse);
  scrollChatToBottom();
}

async function appendHighlight(question: string) {
  if (sending || awaitingResponse || !capture || !currentSessionId) return;
  const sessionId = currentSessionId;
  const selectedCapture = capture;
  const prompt = buildHighlightPrompt(selectedCapture.highlight, question);
  sending = true;
  awaitingResponse = true;
  setComposerEnabled(false);
  setStatus("Sending new highlight...");
  try {
    await waitForEventStream();
    await client().sendMessage(sessionId, prompt);
    if (currentSessionId !== sessionId) return;
    if (capture === selectedCapture) {
      document.querySelector<HTMLElement>("#chat-capture")?.replaceChildren();
    }
    sending = false;
    await refreshMessages(true);
  } catch (error) {
    if (currentSessionId !== sessionId) return;
    sending = false;
    awaitingResponse = false;
    setComposerEnabled(true);
    setStatus(error.message);
  }
}

function messageArticle(messageId: string) {
  return Array.from(document.querySelectorAll<HTMLElement>("#messages .message"))
    .find((article) => article.dataset.messageId === messageId) || null;
}

function beginStreamingMessage(messageId: string) {
  if (!messageId) return;
  if (messageId !== streamingMessageId) {
    streamingMessageId = messageId;
    streamingText = "";
  }
  if (messageArticle(messageId)) return;
  const list = document.querySelector<HTMLElement>("#messages");
  if (!list) return;
  const article = document.createElement("article");
  article.className = "message assistant";
  article.dataset.messageId = messageId;
  article.innerHTML = `<div class="role eyebrow">OpenCode</div>
    <div class="message-content markdown-body"><p class="thinking">Thinking...</p></div>`;
  list.append(article);
  scrollChatToBottom();
}

function renderStreamingText() {
  streamRenderFrame = null;
  if (!streamingMessageId) return;
  let article = messageArticle(streamingMessageId);
  if (!article) {
    beginStreamingMessage(streamingMessageId);
    article = messageArticle(streamingMessageId);
  }
  const content = article?.querySelector<HTMLElement>(".message-content");
  if (!content) return;
  content.innerHTML = streamingText
    ? markdown.render(streamingText)
    : `<p class="thinking">Thinking...</p>`;
  scrollChatToBottom();
}

function scheduleStreamRender() {
  if (streamRenderFrame === null) streamRenderFrame = requestAnimationFrame(renderStreamingText);
}

function handleSessionEvent(event: SessionEvent) {
  const data = event.data;
  if (!data || data.sessionID !== currentSessionId) return;
  switch (event.type) {
    case "session.text.started":
      beginStreamingMessage(data.assistantMessageID || "");
      awaitingResponse = true;
      setComposerEnabled(false);
      setStatus("Responding...");
      break;
    case "session.text.delta":
      beginStreamingMessage(data.assistantMessageID || "");
      streamingText += data.delta || "";
      scheduleStreamRender();
      break;
    case "session.reasoning.started":
      setStatus("Thinking...");
      break;
    case "session.tool.input.started":
      setStatus(data.name ? `Using ${data.name}...` : "Using a tool...");
      break;
    case "session.retry.scheduled":
      setStatus("Retrying...");
      break;
    case "session.input.promoted":
      void refreshMessages(true);
      break;
    case "session.execution.succeeded":
    case "session.execution.failed":
    case "session.execution.interrupted":
      if (streamRenderFrame !== null) cancelAnimationFrame(streamRenderFrame);
      renderStreamingText();
      streamingMessageId = null;
      streamingText = "";
      void refreshMessages(false).finally(() => {
        if (data.sessionID !== currentSessionId) return;
        awaitingResponse = false;
        sending = false;
        setComposerEnabled(true);
        setStatus("");
      });
      break;
  }
}

function waitForEventStream() {
  return Promise.race([
    eventStreamReady,
    new Promise<void>((resolve) => setTimeout(resolve, 5000))
  ]);
}

function startEventStream(sessionId: string): Promise<void> {
  eventStreamAbort?.abort();
  clearTimeout(eventReconnectTimer);
  const generation = ++eventStreamGeneration;
  const controller = new AbortController();
  eventStreamAbort = controller;
  let markConnected = () => {};
  const connected = new Promise<void>((resolve) => markConnected = resolve);
  void client().streamEvents(controller.signal, (event) => {
    if (generation === eventStreamGeneration && currentSessionId === sessionId) {
      handleSessionEvent(event);
    }
  }, markConnected).catch(async (error) => {
    if (controller.signal.aborted || generation !== eventStreamGeneration
      || currentSessionId !== sessionId) return;
    await recordDiagnostic("event-stream-error", { message: String(error?.message || error) });
    setStatus("Reconnecting to OpenCode...");
    if (streamRenderFrame !== null) cancelAnimationFrame(streamRenderFrame);
    streamRenderFrame = null;
    streamingMessageId = null;
    streamingText = "";
    await refreshMessages(awaitingResponse);
    if (generation !== eventStreamGeneration || currentSessionId !== sessionId) return;
    eventReconnectTimer = setTimeout(() => {
      eventStreamReady = startEventStream(sessionId);
      void eventStreamReady.then(() => refreshMessages(awaitingResponse));
    }, 1000);
  });
  return connected;
}

function renderSessionUsage(usage: SessionUsage) {
  const footer = document.querySelector<HTMLElement>("#chat-usage");
  if (!footer) return;
  const compact = new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1
  });
  const exact = new Intl.NumberFormat();
  const fields = [
    `${compact.format(usage.input)} input`,
    `${compact.format(usage.cacheRead)} cached read`,
    `${compact.format(usage.cacheWrite)} cache write`,
    `${compact.format(usage.output)} output`
  ];
  if (usage.reasoning) fields.push(`${compact.format(usage.reasoning)} reasoning`);
  fields.push(`$${usage.cost.toFixed(4)}`);
  footer.textContent = fields.join(" · ");
  footer.title = `Input: ${exact.format(usage.input)}\nCached read: ${exact.format(usage.cacheRead)}`
    + `\nCache write: ${exact.format(usage.cacheWrite)}\nOutput: ${exact.format(usage.output)}`
    + `\nReasoning: ${exact.format(usage.reasoning)}\nCost: $${usage.cost.toFixed(6)}`;
}

async function refreshMessages(expectingResponse: boolean) {
  if (!currentSessionId) return;
  const requestedSession = currentSessionId;
  try {
    const api = client();
    const [messages, usage] = await Promise.all([
      api.messages(requestedSession),
      api.sessionUsage(requestedSession).catch(() => null)
    ]);
    if (requestedSession !== currentSessionId) return;
    if (usage) renderSessionUsage(usage);
    else {
      const footer = document.querySelector<HTMLElement>("#chat-usage");
      if (footer) footer.textContent = "Usage unavailable";
    }
    const messageState = messages
      .map((message) => `${message.id}:${message.text.length}:${message.complete}`)
      .join("|");
    const contentChanged = messageState !== lastRenderedMessageState;
    lastRenderedMessageState = messageState;
    const list = $<HTMLElement>("#messages");
    list.replaceChildren();
    messages.forEach((message) => {
      const article = document.createElement("article");
      article.className = `message ${message.role === "OpenCode" ? "assistant" : "user"}`;
      article.dataset.messageId = message.id;
      const role = document.createElement("div");
      role.className = "role eyebrow";
      role.textContent = message.role;
      const text = document.createElement("div");
      renderMessageText(message, text);
      article.append(role, text);
      list.append(article);
    });
    if (streamingMessageId) renderStreamingText();
    const lastMessage = messages.at(-1);
    const waiting = lastMessage
      ? lastMessage.role === "You" || !lastMessage.complete
      : expectingResponse;
    awaitingResponse = waiting;
    sending = false;
    setComposerEnabled(!waiting);
    setStatus(waiting ? "OpenCode is working..." : "");
    if (contentChanged) scrollChatToBottom();
  } catch (error) {
    setStatus(error.message);
  }
}

async function sendReply() {
  if (sending || awaitingResponse || !currentSessionId) return;
  const sessionId = currentSessionId;
  const input = $<HTMLTextAreaElement>("#reply");
  const text = input.value.trim();
  if (!text) return;
  sending = true;
  awaitingResponse = true;
  setComposerEnabled(false);
  setStatus("Sending...");
  try {
    await waitForEventStream();
    await client().sendMessage(sessionId, text);
    if (currentSessionId !== sessionId) return;
    input.value = "";
    sending = false;
    await refreshMessages(true);
  } catch (error) {
    if (currentSessionId !== sessionId) return;
    sending = false;
    awaitingResponse = false;
    setComposerEnabled(true);
    setStatus(error.message);
  }
}

function originPattern(url: string) {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}/*`;
}

async function ensureServerPermission(serverUrl: string) {
  const origin = originPattern(serverUrl);
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  return chrome.permissions.request({ origins: [origin] });
}

async function showSettings() {
  activeScreen = "settings";
  stopChatUpdates();
  currentSessionId = null;
  app.innerHTML = heading("Settings", "Stored only in this Chrome profile.") + `
    <section class="settings-section">
      <label><span>Server URL</span><input id="server-url" type="url"></label>
      <label><span>Workspace directory</span><input id="directory"></label>
      <label><span>Server password</span><input id="server-password" type="password"></label>
    </section>
    <section class="settings-section">
      <h2>New chat model</h2>
      <select id="model"><option value="">Load models after saving connection</option></select>
      <select id="variant"><option value="">Default variant</option></select>
      <button class="secondary" id="load-models">Load models</button>
    </section>
    <section class="settings-section">
      <h2>Message template</h2>
      <p class="help">Placeholders: {{highlight}}, {{surrounding_context}}, {{page_title}}, {{page_url}}, {{question}}</p>
      <textarea class="template" id="template"></textarea>
    </section>
    <section class="settings-section">
      <h2>Quick questions</h2>
      <div id="preset-editors"></div>
      <button class="secondary" id="add-preset">Add prompt</button>
    </section>
    <button class="primary" id="save-settings">Save and test</button>
    <p class="status"></p>
    <section class="settings-section">
      <h2>Diagnostics</h2>
      <p class="help">Saved locally without passwords, highlights, page text, or page URLs.</p>
      <div class="preset-controls">
        <button class="small" id="copy-diagnostics">Copy logs</button>
        <button class="small" id="clear-diagnostics">Clear logs</button>
      </div>
      <pre class="diagnostics" id="diagnostics">Loading...</pre>
    </section>`;
  $<HTMLInputElement>("#server-url").value = settings.serverUrl;
  $<HTMLInputElement>("#directory").value = settings.directory;
  $<HTMLInputElement>("#server-password").value = settings.serverPassword;
  $<HTMLTextAreaElement>("#template").value = settings.messageTemplate;
  renderPresetEditors(settings.promptPresets.map((preset) => ({ ...preset })));
  $("#load-models").addEventListener("click", () => loadModelsFromForm());
  $("#save-settings").addEventListener("click", saveSettings);
  $("#copy-diagnostics").addEventListener("click", copyDiagnosticLog);
  $("#clear-diagnostics").addEventListener("click", async () => {
    await clearDiagnostics();
    await renderDiagnosticLog();
  });
  await renderDiagnosticLog();
  if (activeScreen !== "settings") return;
  loadModelsFromForm(false);
}

async function diagnosticText(): Promise<string> {
  const entries = await readDiagnostics();
  return JSON.stringify({ extensionVersion: chrome.runtime.getManifest().version, entries }, null, 2);
}

async function renderDiagnosticLog() {
  const output = document.querySelector<HTMLElement>("#diagnostics");
  if (output) output.textContent = await diagnosticText();
}

async function copyDiagnosticLog() {
  try {
    await navigator.clipboard.writeText(await diagnosticText());
    setStatus("Diagnostics copied.");
  } catch (error) {
    await recordDiagnostic("diagnostics-copy-error", {
      message: String(error?.message || error)
    });
    setStatus("Could not copy diagnostics.");
  }
}

function renderPresetEditors(presets: PromptPreset[]) {
  editingPresets = presets;
  const container = $<HTMLElement>("#preset-editors");
  container.replaceChildren();
  presets.forEach((preset, index) => {
    const editor = document.createElement("div");
    editor.className = "preset-editor";
    editor.innerHTML = `<label><span>Button label</span><input class="preset-label"></label>
      <label><span>Prompt</span><textarea class="preset-prompt"></textarea></label>
      <div class="preset-controls">
        <button class="small move-up">Up</button><button class="small move-down">Down</button>
        <button class="small remove">Remove</button>
      </div>`;
    $<HTMLInputElement>(".preset-label", editor).value = preset.label;
    $<HTMLTextAreaElement>(".preset-prompt", editor).value = preset.prompt;
    $<HTMLButtonElement>(".move-up", editor).disabled = index === 0;
    $<HTMLButtonElement>(".move-down", editor).disabled = index === presets.length - 1;
    $<HTMLButtonElement>(".move-up", editor).onclick = () => {
      syncPresetValues(presets);
      [presets[index - 1], presets[index]] = [presets[index], presets[index - 1]];
      renderPresetEditors(presets);
    };
    $<HTMLButtonElement>(".move-down", editor).onclick = () => {
      syncPresetValues(presets);
      [presets[index + 1], presets[index]] = [presets[index], presets[index + 1]];
      renderPresetEditors(presets);
    };
    $<HTMLButtonElement>(".remove", editor).onclick = () => {
      syncPresetValues(presets);
      presets.splice(index, 1);
      renderPresetEditors(presets);
    };
    container.append(editor);
  });
  container.dataset.presets = "active";
  $<HTMLButtonElement>("#add-preset").onclick = () => {
    syncPresetValues(presets);
    presets.push({ label: "New prompt", prompt: "" });
    renderPresetEditors(presets);
  };
}

function syncPresetValues(presets: PromptPreset[]) {
  document.querySelectorAll(".preset-editor").forEach((editor, index) => {
    presets[index].label = $<HTMLInputElement>(".preset-label", editor).value.trim();
    presets[index].prompt = $<HTMLTextAreaElement>(".preset-prompt", editor).value.trim();
  });
}

function settingsFromForm(): Settings {
  const presets = editingPresets;
  syncPresetValues(presets);
  const selectedModel = $<HTMLSelectElement>("#model").selectedOptions[0];
  const hasSelectedModel = Boolean(selectedModel?.dataset.provider && selectedModel?.dataset.model);
  return {
    serverUrl: $<HTMLInputElement>("#server-url").value.trim().replace(/\/+$/, ""),
    directory: $<HTMLInputElement>("#directory").value.trim(),
    serverPassword: $<HTMLInputElement>("#server-password").value.trim(),
    modelProvider: hasSelectedModel ? selectedModel.dataset.provider : settings.modelProvider,
    modelId: hasSelectedModel ? selectedModel.dataset.model : settings.modelId,
    modelVariant: hasSelectedModel ? $<HTMLSelectElement>("#variant").value : settings.modelVariant,
    messageTemplate: $<HTMLTextAreaElement>("#template").value,
    promptPresets: presets
  };
}

async function loadModelsFromForm(requestPermission = true) {
  const temporary = settingsFromForm();
  setStatus("Loading models...");
  try {
    if (requestPermission && !await ensureServerPermission(temporary.serverUrl)) {
      throw new Error("Server access was not granted.");
    }
    const models = await new OpenCodeClient(temporary).models();
    if (activeScreen !== "settings") return;
    const select = $<HTMLSelectElement>("#model");
    select.replaceChildren();
    models.forEach((model) => {
      const option = document.createElement("option");
      option.textContent = `${model.name} (${model.providerId}/${model.modelId})`;
      option.dataset.provider = model.providerId;
      option.dataset.model = model.modelId;
      option.dataset.variants = JSON.stringify(model.variants);
      option.selected = model.providerId === settings.modelProvider && model.modelId === settings.modelId;
      select.append(option);
    });
    select.onchange = updateVariants;
    updateVariants();
    setStatus(models.length ? "" : "No active models found.");
  } catch (error) {
    if (activeScreen === "settings") setStatus(error.message);
  }
}

function updateVariants() {
  const model = $<HTMLSelectElement>("#model").selectedOptions[0];
  const variants = model?.dataset.variants ? JSON.parse(model.dataset.variants) : [];
  const select = $<HTMLSelectElement>("#variant");
  select.replaceChildren(new Option("Default variant", ""));
  variants.forEach((variant) => select.append(new Option(variant, variant)));
  if (model?.dataset.provider === settings.modelProvider && model?.dataset.model === settings.modelId) {
    select.value = settings.modelVariant;
  }
}

async function saveSettings() {
  const next = settingsFromForm();
  if (!next.serverUrl || !next.directory || !next.messageTemplate.trim()) {
    setStatus("Server URL, workspace, and message template are required.");
    return;
  }
  if (next.promptPresets.some((preset) => !preset.label || !preset.prompt)) {
    setStatus("Every quick question needs a label and prompt.");
    return;
  }
  setStatus("Saving and testing...");
  try {
    if (!await ensureServerPermission(next.serverUrl)) {
      throw new Error("Server access was not granted.");
    }
    await new OpenCodeClient(next).health();
    settings = next;
    await chrome.storage.local.set({ settings });
    if (activeScreen === "settings") setStatus("Connected. Chrome settings saved locally.");
  } catch (error) {
    if (activeScreen === "settings") setStatus(error.message);
  }
}

function bindScreenButtons() {
  document.querySelectorAll<HTMLElement>("[data-screen]").forEach((button) => {
    button.addEventListener("click", () => showScreen(button.dataset.screen || "capture"));
  });
}

function showScreen(screen: string) {
  if (screen === "sessions") return showSessions();
  if (screen === "settings") return showSettings();
  return showCapture();
}

bindScreenButtons();
await loadState();
showCapture();

import { OpenCodeClient } from "./api";
import { DEFAULT_SETTINGS, buildPrompt } from "./common";
import type { Capture, PromptPreset, Settings } from "./common";
import { clearDiagnostics, readDiagnostics, recordDiagnostic } from "./diagnostics";

function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI element: ${selector}`);
  return element;
}

const app = $<HTMLElement>("#app");
let settings: Settings;
let capture: Capture | null;
let editingPresets: PromptPreset[] = [];
let currentSessionId: string | null = null;
let currentTabId: number | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let awaitingResponse = false;
let sending = false;
let stateLoaded = false;
const queuedCaptures = new Map<number, Capture>();

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
    if (tabId !== currentTabId) continue;
    capture = nextCapture;
    chrome.storage.session.remove(key);
    showCapture();
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

function stopPolling() {
  clearTimeout(pollTimer);
  pollTimer = null;
  awaitingResponse = false;
  sending = false;
}

function setComposerEnabled(enabled: boolean) {
  const input = document.querySelector<HTMLTextAreaElement>("#reply");
  const button = document.querySelector<HTMLButtonElement>("#send-reply");
  if (input) input.disabled = !enabled;
  if (button) button.disabled = !enabled;
}

function heading(title: string, subtitle: string) {
  return `<h1>${escapeHtml(title)}</h1><p class="subtitle">${escapeHtml(subtitle)}</p>`;
}

async function showCapture() {
  stopPolling();
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
  document.querySelectorAll("button").forEach((button) => button.disabled = true);
  try {
    const api = client();
    const prompt = buildPrompt(settings.messageTemplate, capture, question);
    currentSessionId = await api.createSession(settings);
    await showChat(currentSessionId, true);
    awaitingResponse = true;
    await api.sendMessage(currentSessionId, prompt);
    await refreshMessages(true);
  } catch (error) {
    document.querySelectorAll("button").forEach((button) => button.disabled = false);
    setStatus(error.message);
  }
}

async function showSessions() {
  stopPolling();
  currentSessionId = null;
  app.innerHTML = heading("Shared chats", "Conversations from Chrome and Palma.")
    + `<p class="status">Loading...</p><div id="sessions"></div>`;
  try {
    const sessions = await client().sessions();
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
    setStatus(error.message);
  }
}

async function showChat(sessionId: string, preparingPrompt = false) {
  stopPolling();
  currentSessionId = sessionId;
  app.innerHTML = heading("Conversation", "Reading notes, kept on your OpenCode server.") + `
    <div id="messages"></div>
    <p class="status">Loading...</p>
    <div class="composer">
      <textarea id="reply" placeholder="Continue the conversation..."></textarea>
      <button class="primary" id="send-reply">Send</button>
    </div>`;
  $("#send-reply").addEventListener("click", sendReply);
  $<HTMLTextAreaElement>("#reply").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) sendReply();
  });
  if (preparingPrompt) {
    setComposerEnabled(false);
    setStatus("Sending page context...");
  } else {
    await refreshMessages(false);
  }
}

async function refreshMessages(continuePolling: boolean) {
  if (!currentSessionId) return;
  const requestedSession = currentSessionId;
  try {
    const messages = await client().messages(requestedSession);
    if (requestedSession !== currentSessionId) return;
    const list = $<HTMLElement>("#messages");
    list.replaceChildren();
    messages.forEach((message) => {
      const article = document.createElement("article");
      article.className = `message ${message.role === "OpenCode" ? "assistant" : "user"}`;
      const role = document.createElement("div");
      role.className = "role eyebrow";
      role.textContent = message.role;
      const text = document.createElement("div");
      text.textContent = message.text || "Thinking...";
      article.append(role, text);
      list.append(article);
    });
    const lastMessage = messages.at(-1);
    const waiting = lastMessage
      ? lastMessage.role === "You" || !lastMessage.complete
      : continuePolling;
    awaitingResponse = waiting;
    sending = false;
    setComposerEnabled(!waiting);
    setStatus(waiting ? "OpenCode is working..." : "");
    if (continuePolling || waiting) {
      pollTimer = setTimeout(() => refreshMessages(false), 1200);
    }
  } catch (error) {
    setStatus(error.message);
    if ((continuePolling || awaitingResponse) && requestedSession === currentSessionId) {
      pollTimer = setTimeout(() => refreshMessages(true), 2000);
    }
  }
}

async function sendReply() {
  if (sending || awaitingResponse) return;
  const input = $<HTMLTextAreaElement>("#reply");
  const text = input.value.trim();
  if (!text) return;
  sending = true;
  awaitingResponse = true;
  setComposerEnabled(false);
  setStatus("Sending...");
  try {
    await client().sendMessage(currentSessionId, text);
    input.value = "";
    sending = false;
    await refreshMessages(true);
  } catch (error) {
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
  stopPolling();
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
    setStatus(error.message);
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
    setStatus("Connected. Chrome settings saved locally.");
  } catch (error) {
    setStatus(error.message);
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

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import MarkdownIt from "markdown-it";
import { OpenCodeClient } from "./api";
import type { SessionEvent, SessionUsage } from "./api";
import {
  DEFAULT_SETTINGS,
  buildHighlightPrompt,
  buildPrompt,
  readingPromptFromText
} from "./common";
import type { Capture, Message, Model, ModelRef, PromptPreset, Settings } from "./common";
import { clearDiagnostics, readDiagnostics, recordDiagnostic } from "./diagnostics";

type Screen = "capture" | "sessions" | "chat" | "settings";
type InitialPrompt = { sessionId: string; text: string; capture: Capture } | null;

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true });
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet("target", "_blank");
  tokens[index].attrSet("rel", "noopener noreferrer");
  return renderer.renderToken(tokens, index, options);
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function hasSelectionInside(element: HTMLElement | null) {
  const selection = window.getSelection();
  if (!element || !selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) {
    return false;
  }
  return element.contains(selection.anchorNode) || element.contains(selection.focusNode);
}

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return <><h1>{title}</h1><p className="subtitle">{subtitle}</p></>;
}

function MarkdownContent({ text }: { text: string }) {
  const root = useRef<HTMLDivElement>(null);
  const latestText = useRef(text);
  const [displayedText, setDisplayedText] = useState(text);
  latestText.current = text;

  useEffect(() => {
    if (!hasSelectionInside(root.current)) setDisplayedText(text);
  }, [text]);

  useEffect(() => {
    const applyBufferedText = () => {
      if (!hasSelectionInside(root.current)) setDisplayedText(latestText.current);
    };
    document.addEventListener("selectionchange", applyBufferedText);
    return () => document.removeEventListener("selectionchange", applyBufferedText);
  }, []);

  return <div ref={root} className="message-content markdown-body"
    dangerouslySetInnerHTML={{
      __html: displayedText ? markdown.render(displayedText) : '<p class="thinking">Thinking...</p>'
    }} />;
}

function modelLabel(model?: ModelRef) {
  if (!model) return "";
  return `${model.providerID}/${model.id}${model.variant ? ` (${model.variant})` : ""}`;
}

function ReadingPromptMessage({ text }: { text: string }) {
  const prompt = readingPromptFromText(text);
  if (!prompt) return <div className="message-content plain-message">{text}</div>;
  return <div className="message-content reading-prompt">
    {prompt.question && <p className="prompt-question">{prompt.question}</p>}
    {prompt.highlight && <blockquote>{prompt.highlight}</blockquote>}
    {(prompt.surroundingContext || prompt.pageTitle || prompt.pageUrl) &&
      <details className="prompt-context">
        <summary>View page context</summary>
        {(prompt.pageTitle || prompt.pageUrl) &&
          <p className="prompt-source">{[prompt.pageTitle, prompt.pageUrl].filter(Boolean).join("\n")}</p>}
        {prompt.surroundingContext &&
          <div className="prompt-context-text">{prompt.surroundingContext}</div>}
      </details>}
  </div>;
}

function MessageView({ message }: { message: Message }) {
  return <article className={`message ${message.role === "OpenCode" ? "assistant" : "user"}`}>
    <div className="message-meta"><span className="role eyebrow">{message.role}</span>
      {message.role === "OpenCode" && message.model && <span className="message-model">{modelLabel(message.model)}</span>}
    </div>
    {message.role === "OpenCode"
      ? <MarkdownContent text={message.text} />
      : <ReadingPromptMessage text={message.text} />}
  </article>;
}

function CaptureScreen({ settings, capture, onOpenChat, onBrowse }: {
  settings: Settings;
  capture: Capture | null;
  onOpenChat: (sessionId: string, prompt: string) => void;
  onBrowse: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const contextWordCount = (capture?.surroundingContext.match(/\S+/g) || []).length;
  const estimatedContextTokens = Math.ceil((capture?.surroundingContext.length || 0) / 4);

  const startChat = async (nextQuestion: string) => {
    if (!capture || !nextQuestion.trim() || submitting) return;
    setSubmitting(true);
    setStatus("Starting chat...");
    try {
      const client = new OpenCodeClient(settings);
      const sessionId = await client.createSession(settings);
      onOpenChat(sessionId, buildPrompt(settings.messageTemplate, capture, nextQuestion));
    } catch (error) {
      setSubmitting(false);
      setStatus(errorMessage(error));
    }
  };

  return <>
    <Heading title="Ask the page" subtitle={capture?.pageTitle || "Select a passage on the page to begin."} />
    <div className="eyebrow">Highlight</div>
    <section className="context-card highlight-card">
      {capture ? <blockquote>{capture.highlight}</blockquote> : <p className="empty-capture">No passage selected.</p>}
    </section>
    <div className="eyebrow">Page context ({contextWordCount.toLocaleString()} {contextWordCount === 1 ? "word" : "words"}, ~{estimatedContextTokens.toLocaleString()} tokens)</div>
    <section className="context-card context-preview">{capture?.surroundingContext || "Page context will appear with your selection."}</section>
    <div className="eyebrow">Quick questions</div>
    <div className="button-grid">
      {settings.promptPresets.map((preset, index) =>
        <button className="primary" disabled={!capture || submitting} key={index}
          onClick={() => void startChat(preset.prompt)}>{preset.label}</button>)}
    </div>
    <label><span>Your question</span>
      <textarea value={question} disabled={submitting} onChange={(event) => setQuestion(event.target.value)}
        placeholder="What do you want to understand?" />
    </label>
    <button className="primary" disabled={!capture || submitting} onClick={() => void startChat(question)}>Start chat</button>
    <p className="status">{status}</p>
    <button className="secondary" onClick={onBrowse}>Browse shared chats</button>
  </>;
}

function SessionsScreen({ settings, onOpen }: { settings: Settings; onOpen: (id: string) => void }) {
  const [sessions, setSessions] = useState<Awaited<ReturnType<OpenCodeClient["sessions"]>>>([]);
  const [status, setStatus] = useState("Loading...");

  useEffect(() => {
    let active = true;
    new OpenCodeClient(settings).sessions().then((result) => {
      if (!active) return;
      setSessions(result);
      setStatus(result.length ? "" : "No chats yet.");
    }).catch((error) => active && setStatus(errorMessage(error)));
    return () => { active = false; };
  }, [settings]);

  return <>
    <Heading title="Shared chats" subtitle="Conversations from Chrome and Palma." />
    <p className="status">{status}</p>
    <div>{sessions.map((session) =>
      <button className="session" key={session.id} onClick={() => onOpen(session.id)}>
        <strong>{session.title || "Untitled reading chat"}</strong>
        <span className="session-meta"><time>{session.time?.updated ? new Date(session.time.updated).toLocaleString() : "Unknown date"}</time>
          {session.model && <span>{modelLabel(session.model)}</span>}</span>
      </button>)}</div>
  </>;
}

function Usage({ usage }: { usage: SessionUsage | null }) {
  if (!usage) return <footer className="chat-usage">Usage unavailable</footer>;
  const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
  const exact = new Intl.NumberFormat();
  const fields = [
    `${compact.format(usage.input)} input`,
    `${compact.format(usage.cacheRead)} cached read`,
    `${compact.format(usage.cacheWrite)} cache write`,
    `${compact.format(usage.output)} output`
  ];
  if (usage.reasoning) fields.push(`${compact.format(usage.reasoning)} reasoning`);
  fields.push(`$${usage.cost.toFixed(4)}`);
  const title = `Input: ${exact.format(usage.input)}\nCached read: ${exact.format(usage.cacheRead)}`
    + `\nCache write: ${exact.format(usage.cacheWrite)}\nOutput: ${exact.format(usage.output)}`
    + `\nReasoning: ${exact.format(usage.reasoning)}\nCost: $${usage.cost.toFixed(6)}`;
  return <footer className="chat-usage" title={title}>{fields.join(" · ")}</footer>;
}

function ChatScreen({ settings, capture, sessionId, initialPrompt, onPromptSent, onClearCapture, onNewChat }: {
  settings: Settings;
  capture: Capture | null;
  sessionId: string;
  initialPrompt: InitialPrompt;
  onPromptSent: () => void;
  onClearCapture: (capture: Capture) => void;
  onNewChat: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState<{ id: string; text: string; model?: ModelRef } | null>(null);
  const [usage, setUsage] = useState<SessionUsage | null>(null);
  const [status, setStatus] = useState("Loading...");
  const [reply, setReply] = useState("");
  const [waiting, setWaiting] = useState(Boolean(initialPrompt));
  const streamReady = useRef<Promise<void>>(Promise.resolve());
  const refreshRef = useRef<(expecting: boolean) => Promise<void>>(async () => {});
  const onPromptSentRef = useRef(onPromptSent);
  const messagesRef = useRef(messages);
  const waitingRef = useRef(waiting);
  const streamingModels = useRef(new Map<string, ModelRef>());
  const pinnedToBottom = useRef(true);
  onPromptSentRef.current = onPromptSent;
  messagesRef.current = messages;
  waitingRef.current = waiting;

  const refreshMessages = async (expecting: boolean) => {
    try {
      const client = new OpenCodeClient(settings);
      const [nextMessages, nextUsage] = await Promise.all([
        client.messages(sessionId),
        client.sessionUsage(sessionId).catch(() => null)
      ]);
      setMessages(nextMessages);
      setUsage(nextUsage);
      const last = nextMessages.at(-1);
      const nextWaiting = last ? last.role === "You" || !last.complete : expecting;
      setWaiting(nextWaiting);
      setStatus(nextWaiting ? "OpenCode is working..." : "");
    } catch (error) {
      setStatus(errorMessage(error));
    }
  };
  refreshRef.current = refreshMessages;

  useEffect(() => {
    const recordScroll = () => { pinnedToBottom.current = false; };
    const updatePinned = () => {
      const root = document.scrollingElement || document.documentElement;
      pinnedToBottom.current = root.scrollHeight - root.scrollTop - root.clientHeight <= 24;
    };
    const pointerdown = (event: PointerEvent) => {
      if (event.clientX >= window.innerWidth - 20) recordScroll();
    };
    const keydown = (event: KeyboardEvent) => {
      if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
        || event.target instanceof HTMLSelectElement)
        && ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
        recordScroll();
      }
    };
    document.addEventListener("wheel", recordScroll, { passive: true });
    document.addEventListener("touchmove", recordScroll, { passive: true });
    document.addEventListener("scroll", updatePinned, { passive: true });
    document.addEventListener("pointerdown", pointerdown);
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("wheel", recordScroll);
      document.removeEventListener("touchmove", recordScroll);
      document.removeEventListener("scroll", updatePinned);
      document.removeEventListener("pointerdown", pointerdown);
      document.removeEventListener("keydown", keydown);
    };
  }, []);

  useEffect(() => {
    if (!pinnedToBottom.current || !window.getSelection()?.isCollapsed) return;
    const frame = requestAnimationFrame(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" }));
    return () => cancelAnimationFrame(frame);
  }, [messages, streaming?.text, capture]);

  useEffect(() => {
    let stopped = false;
    let controller: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let markReady = () => {};
    streamReady.current = new Promise<void>((resolve) => { markReady = resolve; });

    const handleEvent = (event: SessionEvent) => {
      const data = event.data;
      if (!data || data.sessionID !== sessionId) return;
      const messageId = data.assistantMessageID || "";
      switch (event.type) {
        case "session.step.started":
          if (messageId && data.model) {
            streamingModels.current.set(messageId, data.model);
            setStreaming((current) => current?.id === messageId ? { ...current, model: data.model } : current);
          }
          break;
        case "session.text.started":
          if (messageId) setStreaming((current) => current?.id === messageId ? current : {
            id: messageId,
            text: messagesRef.current.find((message) => message.id === messageId)?.text || "",
            model: messagesRef.current.find((message) => message.id === messageId)?.model
              || streamingModels.current.get(messageId)
          });
          setWaiting(true);
          setStatus("Responding...");
          break;
        case "session.text.delta":
          if (messageId) setStreaming((current) => ({
            id: messageId,
            text: (current?.id === messageId
              ? current.text
              : messagesRef.current.find((message) => message.id === messageId)?.text || "")
              + (data.delta || ""),
            model: current?.id === messageId ? current.model : streamingModels.current.get(messageId)
          }));
          break;
        case "session.reasoning.started": setStatus("Thinking..."); break;
        case "session.tool.input.started": setStatus(data.name ? `Using ${data.name}...` : "Using a tool..."); break;
        case "session.retry.scheduled": setStatus("Retrying..."); break;
        case "session.input.promoted": void refreshRef.current(true); break;
        case "session.execution.succeeded":
        case "session.execution.failed":
        case "session.execution.interrupted":
          void refreshRef.current(false).finally(() => {
            setStreaming(null);
            setWaiting(false);
            setStatus("");
          });
          break;
      }
    };

    const connect = () => {
      if (stopped) return;
      controller = new AbortController();
      void new OpenCodeClient(settings).streamEvents(controller.signal, handleEvent, markReady).catch(async (error) => {
        if (stopped || controller?.signal.aborted) return;
        await recordDiagnostic("event-stream-error", { message: errorMessage(error) });
        setStatus("Reconnecting to OpenCode...");
        setStreaming(null);
        await refreshRef.current(waitingRef.current);
        reconnectTimer = setTimeout(connect, 1000);
      });
    };
    connect();
    if (!initialPrompt) void refreshRef.current(false);
    return () => {
      stopped = true;
      controller?.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [sessionId, settings]);

  useEffect(() => {
    if (!initialPrompt || initialPrompt.sessionId !== sessionId) return;
    let active = true;
    void Promise.race([
      streamReady.current,
      new Promise<void>((resolve) => setTimeout(resolve, 5000))
    ]).then(() => new OpenCodeClient(settings).sendMessage(sessionId, initialPrompt.text))
      .then(() => {
        if (!active) return;
        onPromptSentRef.current();
        return refreshRef.current(true);
      }).catch((error) => {
        if (!active) return;
        setWaiting(false);
        setStatus(errorMessage(error));
      });
    return () => { active = false; };
  }, [initialPrompt, sessionId, settings]);

  const sendReply = async (override?: string) => {
    const text = (override || reply).trim();
    if (!text || waiting) return;
    const selectedCapture = capture;
    setWaiting(true);
    setStatus(selectedCapture ? "Sending with highlight..." : "Sending...");
    try {
      await Promise.race([streamReady.current, new Promise<void>((resolve) => setTimeout(resolve, 5000))]);
      await new OpenCodeClient(settings).sendMessage(sessionId,
        selectedCapture ? buildHighlightPrompt(selectedCapture.highlight, text) : text);
      setReply("");
      if (selectedCapture) onClearCapture(selectedCapture);
      await refreshMessages(true);
    } catch (error) {
      setWaiting(false);
      setStatus(errorMessage(error));
    }
  };

  const stopExecution = async () => {
    setStatus("Stopping...");
    try {
      await new OpenCodeClient(settings).interruptSession(sessionId);
      setStreaming(null);
      setWaiting(false);
      await refreshMessages(false);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  };

  const visibleMessages = [...messages];
  if (streaming) {
    const index = visibleMessages.findIndex((message) => message.id === streaming.id);
    const streamedMessage: Message = {
      id: streaming.id,
      role: "OpenCode",
      text: streaming.text,
      complete: false,
      model: streaming.model
    };
    if (index >= 0) visibleMessages[index] = streamedMessage;
    else visibleMessages.push(streamedMessage);
  }

  const composerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void sendReply();
  };

  return <>
    <Heading title="Conversation" subtitle="Reading notes, kept on your OpenCode server." />
    <div id="messages">{visibleMessages.map((message) =>
      <MessageView key={message.id} message={message} />)}</div>
    <p className="status">{status}</p>
    <div className="composer">
      <div id="context-prompts"><div className="chat-capture-presets">
        {settings.promptPresets.map((preset, index) =>
          <button className="quick-prompt context-control" disabled={!capture || waiting} key={index}
            onClick={() => void sendReply(preset.prompt)}>{preset.label}</button>)}
      </div></div>
      <textarea value={reply} disabled={waiting} onChange={(event) => setReply(event.target.value)}
        onKeyDown={composerKeyDown}
        placeholder={capture ? "Ask about this highlight or continue the conversation..." : "Continue the conversation..."} />
      <div id="chat-capture"><section className="chat-capture-card">
        <div className="eyebrow">Including new highlight</div>
        {capture ? <blockquote>{capture.highlight}</blockquote> : <p className="empty-capture">No new passage selected.</p>}
      </section></div>
      <div className="composer-actions has-capture">
        <button className="primary" disabled={waiting} onClick={() => void sendReply()}>Send</button>
        {waiting
          ? <button className="secondary" onClick={() => void stopExecution()}>Stop</button>
          : <button className="secondary context-control" onClick={onNewChat}>New chat</button>}
      </div>
      <Usage usage={usage} />
    </div>
  </>;
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

async function diagnosticText() {
  const entries = await readDiagnostics();
  return JSON.stringify({ extensionVersion: chrome.runtime.getManifest().version, entries }, null, 2);
}

function SettingsScreen({ settings, onSave }: { settings: Settings; onSave: (settings: Settings) => void }) {
  const [draft, setDraft] = useState<Settings>(() => ({
    ...settings,
    promptPresets: settings.promptPresets.map((preset) => ({ ...preset }))
  }));
  const [models, setModels] = useState<Model[]>([]);
  const [status, setStatus] = useState("");
  const [diagnostics, setDiagnostics] = useState("Loading...");

  const updateDiagnostics = () => void diagnosticText().then(setDiagnostics);
  useEffect(updateDiagnostics, []);

  const persist = (next: Settings) => {
    setDraft(next);
    onSave(next);
    void chrome.storage.local.set({ settings: next }).catch((error) => setStatus(errorMessage(error)));
  };
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    persist({ ...draft, [key]: value });
  };
  const updatePreset = (index: number, patch: Partial<PromptPreset>) => {
    update("promptPresets", draft.promptPresets.map((preset, presetIndex) =>
      presetIndex === index ? { ...preset, ...patch } : preset));
  };
  const movePreset = (index: number, direction: -1 | 1) => {
    const next = [...draft.promptPresets];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    update("promptPresets", next);
  };
  const loadModels = async (requestPermission = true) => {
    setStatus("Loading models...");
    try {
      if (requestPermission && !await ensureServerPermission(draft.serverUrl)) {
        throw new Error("Server access was not granted.");
      }
      const nextModels = await new OpenCodeClient(draft).models();
      setModels(nextModels);
      setStatus(nextModels.length ? "" : "No active models found.");
    } catch (error) {
      setStatus(errorMessage(error));
    }
  };
  useEffect(() => { void loadModels(false); }, []);
  const selectedModel = `${draft.modelProvider}\0${draft.modelId}`;
  const variants = models.find((model) => `${model.providerId}\0${model.modelId}` === selectedModel)?.variants || [];
  const selectModel = (value: string) => {
    const [modelProvider, modelId] = value.split("\0");
    persist({ ...draft, modelProvider, modelId, modelVariant: "" });
  };

  return <>
    <Heading title="Settings" subtitle="Changes save automatically in this Chrome profile." />
    <section className="settings-section">
      <label><span>Server URL</span><input type="url" value={draft.serverUrl} onChange={(e) => update("serverUrl", e.target.value)} /></label>
      <label><span>Workspace directory</span><input value={draft.directory} onChange={(e) => update("directory", e.target.value)} /></label>
      <label><span>Server password</span><input type="password" value={draft.serverPassword} onChange={(e) => update("serverPassword", e.target.value)} /></label>
    </section>
    <section className="settings-section">
      <h2>New chat model</h2>
      <select value={selectedModel} onChange={(e) => selectModel(e.target.value)}>
        {!models.length && <option value={selectedModel}>Load models after saving connection</option>}
        {models.map((model) => <option key={`${model.providerId}/${model.modelId}`}
          value={`${model.providerId}\0${model.modelId}`}>{model.name} ({model.providerId}/{model.modelId})</option>)}
      </select>
      <select value={draft.modelVariant} onChange={(e) => update("modelVariant", e.target.value)}>
        <option value="">Default variant</option>
        {variants.map((variant) => <option key={variant} value={variant}>{variant}</option>)}
      </select>
      <button className="secondary" onClick={() => void loadModels()}>Load models</button>
    </section>
    <section className="settings-section">
      <h2>Message template</h2>
      <p className="help">Placeholders: {"{{highlight}}, {{surrounding_context}}, {{page_title}}, {{page_url}}, {{question}}"}</p>
      <textarea className="template" value={draft.messageTemplate} onChange={(e) => update("messageTemplate", e.target.value)} />
    </section>
    <section className="settings-section">
      <h2>Quick questions</h2>
      {draft.promptPresets.map((preset, index) => <div className="preset-editor" key={index}>
        <label><span>Button label</span><input value={preset.label} onChange={(e) => updatePreset(index, { label: e.target.value })} /></label>
        <label><span>Prompt</span><textarea value={preset.prompt} onChange={(e) => updatePreset(index, { prompt: e.target.value })} /></label>
        <div className="preset-controls">
          <button className="small" disabled={index === 0} onClick={() => movePreset(index, -1)}>Up</button>
          <button className="small" disabled={index === draft.promptPresets.length - 1} onClick={() => movePreset(index, 1)}>Down</button>
          <button className="small" onClick={() => update("promptPresets", draft.promptPresets.filter((_, i) => i !== index))}>Remove</button>
        </div>
      </div>)}
      <button className="secondary" onClick={() => update("promptPresets", [...draft.promptPresets, { label: "New prompt", prompt: "" }])}>Add prompt</button>
    </section>
    <p className="status">{status}</p>
    <section className="settings-section">
      <h2>Diagnostics</h2>
      <p className="help">Saved locally without passwords, highlights, page text, or page URLs.</p>
      <div className="preset-controls">
        <button className="small" onClick={() => void diagnosticText().then((text) => navigator.clipboard.writeText(text))
          .then(() => setStatus("Diagnostics copied."))
          .catch(async (error) => {
            await recordDiagnostic("diagnostics-copy-error", { message: errorMessage(error) });
            setStatus("Could not copy diagnostics.");
          })}>Copy logs</button>
        <button className="small" onClick={() => void clearDiagnostics().then(updateDiagnostics)}>Clear logs</button>
      </div>
      <pre className="diagnostics">{diagnostics}</pre>
    </section>
  </>;
}

function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [screen, setScreen] = useState<Screen>("capture");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [initialPrompt, setInitialPrompt] = useState<InitialPrompt>(null);
  const currentTabId = useRef<number | null>(null);
  const screenRef = useRef(screen);
  screenRef.current = screen;

  useEffect(() => {
    let active = true;
    const queuedCaptures = new Map<number, Capture>();
    const storageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "session") return;
      for (const [key, change] of Object.entries(changes)) {
        if (!key.startsWith("pendingCapture:") || change.newValue === undefined) continue;
        const tabId = Number(key.slice("pendingCapture:".length));
        if (currentTabId.current === null) {
          if (change.newValue) queuedCaptures.set(tabId, change.newValue as Capture);
          continue;
        }
        if (!change.newValue) {
          if (tabId === currentTabId.current) setCapture(null);
          continue;
        }
        currentTabId.current = tabId;
        setCapture(change.newValue as Capture);
        void chrome.storage.session.remove(key);
        if (screenRef.current !== "chat") {
          setSessionId(null);
          setInitialPrompt(null);
          setScreen("capture");
        }
      }
    };
    chrome.storage.onChanged.addListener(storageListener);
    void Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }),
      chrome.storage.local.get("settings")
    ]).then(async ([tabs, stored]) => {
      if (!active) return;
      currentTabId.current = tabs[0]?.id ?? null;
      const saved = stored as { settings?: Partial<Settings> };
      setSettings({
        ...DEFAULT_SETTINGS,
        ...(saved.settings || {}),
        promptPresets: saved.settings?.promptPresets || DEFAULT_SETTINGS.promptPresets
      });
      if (currentTabId.current === null) return;
      const key = `pendingCapture:${currentTabId.current}`;
      const pending = await chrome.storage.session.get(key) as Record<string, Capture>;
      if (!active) return;
      const nextCapture = queuedCaptures.get(currentTabId.current) || pending[key] || null;
      setCapture(nextCapture);
      if (nextCapture) await chrome.storage.session.remove(key);
    });
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(storageListener);
    };
  }, []);

  const navigate = (next: Screen) => {
    setScreen(next);
    if (next !== "chat") {
      setSessionId(null);
      setInitialPrompt(null);
    }
  };
  const openChat = (id: string, prompt?: string) => {
    setSessionId(id);
    setInitialPrompt(prompt && capture ? { sessionId: id, text: prompt, capture } : null);
    setScreen("chat");
  };

  if (!settings) return <main id="app"><p className="status">Loading...</p></main>;
  let content: ReactNode;
  if (screen === "sessions") content = <SessionsScreen settings={settings} onOpen={openChat} />;
  else if (screen === "settings") content = <SettingsScreen settings={settings} onSave={setSettings} />;
  else if (screen === "chat" && sessionId) content = <ChatScreen settings={settings} capture={capture}
    sessionId={sessionId} initialPrompt={initialPrompt} onPromptSent={() => {
      if (initialPrompt) setCapture((current) => current === initialPrompt.capture ? null : current);
      setInitialPrompt(null);
    }}
    onClearCapture={(used) => setCapture((current) => current === used ? null : current)}
    onNewChat={() => navigate("capture")} />;
  else content = <CaptureScreen settings={settings} capture={capture} onOpenChat={openChat}
    onBrowse={() => navigate("sessions")} />;

  return <>
    <header>
      <button className="brand" onClick={() => navigate("capture")}>RC</button>
      <nav>
        <button onClick={() => navigate("capture")}>New</button>
        <button onClick={() => navigate("sessions")}>Chats</button>
        <button onClick={() => navigate("settings")}>Settings</button>
      </nav>
    </header>
    <main id="app" aria-live="polite">{content}</main>
  </>;
}

createRoot(document.getElementById("root")!).render(<App />);

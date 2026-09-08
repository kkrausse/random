import {
  memo,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  ChatController,
  PermissionRequest,
  QuestionRequest,
  RequestState,
  SessionMessageInfo,
} from "./types";
import { Markdown } from "./markdown";
export { Markdown, CodeBlock } from "./markdown";
export type OpenFile = (
  path: string,
  selection?: { startLine: number; endLine: number },
) => void;
export interface ChatViewProps {
  controller: ChatController;
  showSessions?: boolean;
  showModels?: boolean;
  onOpenFile?: OpenFile;
}
export const useChatSnapshot = (controller: ChatController) =>
  useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
const run = (promise: Promise<unknown>) => {
  void promise.catch(() => {});
};
const pretty = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);
type Part = Extract<
  SessionMessageInfo,
  { type: "assistant" }
>["content"][number];

export const ToolCard = memo(function ToolCard({
  part,
  onOpenFile,
}: {
  part: Extract<Part, { type: "tool" }>;
  onOpenFile?: OpenFile;
}) {
  const input = part.state.input;
  const file =
    typeof input === "object" &&
    input &&
    ("path" in input
      ? input.path
      : "filePath" in input
        ? input.filePath
        : undefined);
  return (
    <details className="oc-tool">
      <summary>
        <strong>{part.name}</strong>
        <span>{part.state.status}</span>
      </summary>
      {typeof file === "string" && onOpenFile && (
        <button type="button" onClick={() => onOpenFile(file)}>
          Open {file}
        </button>
      )}
      <h4>Input</h4>
      <pre>{pretty(input)}</pre>
      {"content" in part.state && (
        <>
          <h4>Output</h4>
          <pre>
            {part.state.content
              ?.map((content) =>
                content.type === "text" ? content.text : pretty(content),
              )
              .join("\n")}
          </pre>
        </>
      )}
      {"error" in part.state && (
        <pre role="alert">{pretty(part.state.error)}</pre>
      )}
      {"metadata" in part.state &&
        part.state.metadata &&
        Object.keys(part.state.metadata).length > 0 && (
          <details>
            <summary>Details / changes</summary>
            <pre>{pretty(part.state.metadata)}</pre>
          </details>
        )}
    </details>
  );
});
export const MessagePart = memo(function MessagePart({
  part,
  onOpenFile,
}: {
  part: Part;
  onOpenFile?: OpenFile;
}) {
  if (part.type === "text") return <Markdown text={part.text} />;
  if (part.type === "reasoning")
    return (
      <details className="oc-reasoning">
        <summary>Reasoning</summary>
        <Markdown text={part.text} />
      </details>
    );
  if (part.type === "tool")
    return <ToolCard part={part} onOpenFile={onOpenFile} />;
  return <pre>{pretty(part)}</pre>;
});
const MessageRow = memo(function MessageRow({
  message,
  onOpenFile,
}: {
  message: SessionMessageInfo;
  onOpenFile?: OpenFile;
}) {
  return (
    <article
      className={`oc-message oc-message-${message.type}`}
      aria-label={`${message.type} message`}
    >
      <div className="oc-role">
        {message.type === "user"
          ? "You"
          : message.type === "assistant"
            ? "OpenCode"
            : message.type}
      </div>
      {"text" in message && <Markdown text={message.text} />}
      {message.type === "assistant" &&
        message.content.map((part, i) => (
          <MessagePart
            key={part.type === "tool" ? part.id : `${part.type}-${i}`}
            part={part}
            onOpenFile={onOpenFile}
          />
        ))}
      {"files" in message &&
        message.files?.map((file, i) => (
          <div key={i} className="oc-file">
            {file.name || file.mime}
            {onOpenFile &&
              file.source?.type === "uri" &&
              file.source.uri.startsWith("file://") && (
                <button
                  onClick={() =>
                    onOpenFile(
                      decodeURIComponent(
                        new URL(
                          file.source!.type === "uri"
                            ? file.source!.uri
                            : "file:///",
                        ).pathname,
                      ),
                    )
                  }
                >
                  Open file
                </button>
              )}
          </div>
        ))}
      {"error" in message && message.error && (
        <pre role="alert">{pretty(message.error)}</pre>
      )}
      {message.type === "assistant" && message.retry && (
        <p role="status">
          Retry {message.retry.attempt}: {pretty(message.retry.error)}
        </p>
      )}
      {message.type !== "assistant" && !("text" in message) && (
        <pre>{pretty(message)}</pre>
      )}
    </article>
  );
});
export function Transcript({
  controller,
  onOpenFile,
}: {
  controller: ChatController;
  onOpenFile?: OpenFile;
}) {
  const state = useChatSnapshot(controller),
    viewport = useRef<HTMLDivElement>(null),
    following = useRef(true);
  const anchor = useRef<{ height: number; top: number } | null>(null),
    session = useRef(state.sessionID);
  const [away, setAway] = useState(false);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    if (session.current !== state.sessionID) {
      session.current = state.sessionID;
      following.current = true;
      anchor.current = null;
    }
    if (anchor.current && !state.loadingOlder) {
      el.scrollTop =
        anchor.current.top + el.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else {
      const selection = el.ownerDocument.getSelection();
      if (
        selection &&
        !selection.isCollapsed &&
        el.contains(selection.anchorNode)
      )
        following.current = false;
      if (following.current) el.scrollTop = el.scrollHeight;
    }
    setAway(!following.current);
  }, [state.messages, state.sessionID, state.loadingOlder]);
  return (
    <div className="oc-transcript-wrap">
      <div
        className="oc-transcript"
        ref={viewport}
        role="log"
        aria-label="Conversation"
        aria-live="off"
        onScroll={() => {
          const el = viewport.current!;
          following.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 64;
          setAway(!following.current);
        }}
      >
        {state.hasOlder && (
          <button
            disabled={state.loadingOlder}
            onClick={() => {
              const el = viewport.current!;
              anchor.current = { height: el.scrollHeight, top: el.scrollTop };
              following.current = false;
              run(controller.loadOlder());
            }}
          >
            {state.loadingOlder ? "Loading…" : "Load earlier messages"}
          </button>
        )}
        {state.loading && (
          <p className="oc-empty" role="status">
            Loading conversation…
          </p>
        )}
        {!state.loading && !state.messages.length && (
          <div className="oc-empty">
            <h3>
              {state.sessionID
                ? "What would you like to build?"
                : "Start a conversation"}
            </h3>
            <p>
              {state.sessionID
                ? "Ask a question, explore your code, or describe a change."
                : "Choose a session or create a new chat above."}
            </p>
          </div>
        )}
        {state.messages.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>
      {away && (
        <button
          className="oc-latest"
          onClick={() => {
            following.current = true;
            viewport.current!.scrollTop = viewport.current!.scrollHeight;
            setAway(false);
          }}
        >
          Jump to latest ↓
        </button>
      )}
    </div>
  );
}
export function PermissionCard({
  controller,
  entry,
}: {
  controller: ChatController;
  entry: RequestState<PermissionRequest>;
}) {
  return (
    <section className="oc-request" aria-label="Permission request">
      <strong>Permission needed: {entry.request.action}</strong>
      <pre>{entry.request.resources.join("\n")}</pre>
      <div className="oc-actions">
        {(
          [
            ["once", "Allow once"],
            ["always", "Always allow"],
            ["reject", "Reject"],
          ] as const
        ).map(([decision, label]) => (
          <button
            key={decision}
            disabled={entry.submitting}
            onClick={() =>
              run(controller.replyPermission(entry.request.id, decision))
            }
          >
            {label}
          </button>
        ))}
      </div>
      {entry.error && (
        <p role="alert">{entry.error} — choose a response to retry.</p>
      )}
    </section>
  );
}
export function QuestionCard({
  controller,
  entry,
}: {
  controller: ChatController;
  entry: RequestState<QuestionRequest>;
}) {
  const [answers, setAnswers] = useState<string[][]>(() =>
      entry.request.questions.map(() => []),
    ),
    [custom, setCustom] = useState<Record<number, string>>({});
  const complete = entry.request.questions.map((q, i) =>
    custom[i]?.trim()
      ? q.multiple
        ? [...answers[i]!, custom[i]!.trim()]
        : [custom[i]!.trim()]
      : answers[i]!,
  );
  return (
    <form
      className="oc-request"
      onSubmit={(e) => {
        e.preventDefault();
        run(controller.replyQuestion(entry.request.id, complete));
      }}
    >
      {entry.request.questions.map((q, i) => (
        <fieldset key={i} disabled={entry.submitting}>
          <legend>
            {q.header}: {q.question}
          </legend>
          {q.options.map((option) => (
            <label className="oc-option" key={option.label}>
              <input
                type={q.multiple ? "checkbox" : "radio"}
                name={`${entry.request.id}-${i}`}
                checked={answers[i]?.includes(option.label) ?? false}
                onChange={(e) => {
                  setAnswers((previous) =>
                    previous.map((a, j) =>
                      j !== i
                        ? a
                        : q.multiple
                          ? e.target.checked
                            ? [...a, option.label]
                            : a.filter((v) => v !== option.label)
                          : [option.label],
                    ),
                  );
                  if (!q.multiple) setCustom((c) => ({ ...c, [i]: "" }));
                }}
              />
              <span>
                {option.label}
                <small>{option.description}</small>
              </span>
            </label>
          ))}
          {q.custom !== false && (
            <label>
              Custom answer
              <input
                value={custom[i] ?? ""}
                onChange={(e) => {
                  setCustom((c) => ({ ...c, [i]: e.target.value }));
                  if (!q.multiple)
                    setAnswers((a) => a.map((v, j) => (i === j ? [] : v)));
                }}
              />
            </label>
          )}
        </fieldset>
      ))}
      <div className="oc-actions">
        <button
          type="submit"
          disabled={entry.submitting || complete.some((a) => !a.length)}
        >
          Submit answers
        </button>
        <button
          type="button"
          disabled={entry.submitting}
          onClick={() => run(controller.rejectQuestion(entry.request.id))}
        >
          Skip
        </button>
      </div>
      {entry.error && <p role="alert">{entry.error} — you can retry.</p>}
    </form>
  );
}
export function Composer({ controller }: { controller: ChatController }) {
  const state = useChatSnapshot(controller),
    [text, setText] = useState("");
  const disabled =
    !state.sessionID ||
    state.connection !== "connected" ||
    state.loading ||
    state.sending ||
    state.execution !== "idle";
  const send = () => {
    if (disabled || !text.trim()) return;
    const draft = text;
    void controller.send({ text: draft }).then(
      () => setText((current) => (current === draft ? "" : current)),
      () => {},
    );
  };
  return (
    <form
      className="oc-composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        aria-label="Message OpenCode"
        placeholder="Message OpenCode…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            !e.shiftKey &&
            !e.nativeEvent.isComposing &&
            e.nativeEvent.keyCode !== 229
          ) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="oc-actions">
        <small>Enter to send · Shift+Enter for a new line</small>
        {state.execution !== "idle" && state.sessionID ? (
          <button
            type="button"
            disabled={state.connection !== "connected"}
            onClick={() => run(controller.interrupt())}
          >
            {state.interruptRequested ? "Stop requested · Retry" : "Stop"}
          </button>
        ) : (
          <button type="submit" disabled={disabled || !text.trim()}>
            {state.sending ? "Sending…" : "Send ↑"}
          </button>
        )}
      </div>
    </form>
  );
}
/** Unmount only unsubscribes. The host owns and disposes the supplied controller. */
export function ChatView({
  controller,
  showSessions = true,
  showModels = true,
  onOpenFile,
}: ChatViewProps) {
  const state = useChatSnapshot(controller);
  return (
    <section className="oc-chat" aria-label="OpenCode chat">
      <header className="oc-toolbar">
        <strong>OpenCode</strong>
        <span role="status">
          {state.connection === "connected"
            ? state.execution === "idle"
              ? "Ready"
              : state.execution === "unknown"
                ? "Checking execution…"
                : state.execution === "retrying"
                  ? "Retrying…"
                  : "Working…"
            : state.connection}
        </span>
        <button
          disabled={state.connection === "connecting"}
          onClick={() => run(controller.reconnect())}
        >
          Reconnect
        </button>
      </header>
      {(showSessions || showModels) && (
        <nav className="oc-controls" aria-label="Chat settings">
          {showSessions && (
            <>
              <label>
                Session
                <select
                  aria-label="Session"
                  value={state.sessionID ?? ""}
                  onChange={(e) =>
                    run(controller.selectSession(e.target.value))
                  }
                >
                  <option value="" disabled>
                    Select session
                  </option>
                  {state.sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title || s.id}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={state.connection !== "connected" || state.loading}
                onClick={() => run(controller.createSession())}
              >
                New chat
              </button>
            </>
          )}
          {showModels && (
            <label>
              Model
              <select
                aria-label="Model"
                disabled={
                  !state.sessionID ||
                  state.connection !== "connected" ||
                  state.execution !== "idle"
                }
                value={
                  state.model
                    ? JSON.stringify({
                        providerID: state.model.providerID,
                        id: state.model.id,
                      })
                    : ""
                }
                onChange={(e) =>
                  run(controller.selectModel(JSON.parse(e.target.value)))
                }
              >
                <option value="" disabled>
                  Server default
                </option>
                {state.models
                  .filter((m) => m.enabled)
                  .map((m) => (
                    <option
                      key={`${m.providerID}/${m.id}`}
                      value={JSON.stringify({
                        providerID: m.providerID,
                        id: m.id,
                      })}
                    >
                      {m.name} · {m.providerID}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </nav>
      )}
      {state.error && (
        <div className="oc-error" role="alert">
          <span>{state.error}</span>
          <button onClick={() => controller.clearError()}>Dismiss</button>
        </div>
      )}
      <Transcript controller={controller} onOpenFile={onOpenFile} />
      <div className="oc-requests">
        {state.permissions.map((entry) => (
          <PermissionCard
            key={entry.request.id}
            controller={controller}
            entry={entry}
          />
        ))}
        {state.questions.map((entry) => (
          <QuestionCard
            key={entry.request.id}
            controller={controller}
            entry={entry}
          />
        ))}
      </div>
      <Composer key={state.sessionID ?? "none"} controller={controller} />
    </section>
  );
}

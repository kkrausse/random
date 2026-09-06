import { useEffect, useRef, useState } from "react";
import { Play, RotateCcw, TerminalSquare } from "lucide-react";
import "./styles.css";
import bridgeSource from "../guest/preview-bridge.ts?raw";

type RuntimeStatus = "idle" | "loading" | "running" | "error";

const labels: Record<RuntimeStatus, string> = {
  idle: "Not started",
  loading: "Loading VM",
  running: "QEMU running",
  error: "Runtime error",
};

export function App() {
  const [status, setStatus] = useState<RuntimeStatus>("idle");
  const [bootKey, setBootKey] = useState(0);
  const [detail, setDetail] = useState("Ready to allocate the browser VM.");
  const runtime = useRef<HTMLIFrameElement>(null);
  const preview = useRef<HTMLIFrameElement>(null);
  const [previewStatus, setPreviewStatus] = useState("disconnected");
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState("");
  const isolated = window.crossOriginIsolated;
  const artifactsReady = status !== "idle" || bootKey > 0;

  useEffect(() => {
    const relay = (event: MessageEvent) => {
      if (!["guest-http", "guest-ws"].includes(event.data?.source) || !event.ports[0]) return;
      if (event.data.source === "guest-http" && event.currentTarget !== navigator.serviceWorker) return;
      if (event.data.source === "guest-ws" && (event.origin !== location.origin || event.source !== preview.current?.contentWindow)) return;
      runtime.current?.contentWindow?.postMessage({ source: "preview-bridge", request: event.data.request }, location.origin, [event.ports[0]]);
    };
    navigator.serviceWorker?.addEventListener("message", relay);
    window.addEventListener("message", relay);
    return () => {
      navigator.serviceWorker?.removeEventListener("message", relay);
      window.removeEventListener("message", relay);
    };
  }, []);

  const connectPreview = async () => {
    setPreviewStatus("connecting");
    try {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "/serial-bridge.js";
        script.onload = () => { script.remove(); resolve(); };
        script.onerror = () => { script.remove(); reject(new Error("Could not load serial bridge")); };
        document.head.append(script);
      });
      const { installSerialBridge } = window as unknown as {
        installSerialBridge: (slave: unknown, runtime: Window) => { connect(source: string): Promise<void> };
      };
      const frame = runtime.current!.contentWindow!;
      const bridge = installSerialBridge((frame as unknown as { Module: { pty: unknown } }).Module.pty, frame);
      await bridge.connect(bridgeSource);
      const registration = await navigator.serviceWorker.register("/preview-sw.js", { scope: "/__guest/" });
      const worker = registration.installing || registration.waiting;
      if (worker && worker.state !== "activated") await new Promise<void>((resolve) => {
        worker.addEventListener("statechange", () => { if (worker.state === "activated") resolve(); });
      });
      await new Promise<void>((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => { channel.port1.close(); reject(new Error("Preview cache reset timed out")); }, 5_000);
        channel.port1.onmessage = () => { clearTimeout(timer); channel.port1.close(); resolve(); };
        registration.active!.postMessage({ source: "preview-cache", type: "reset" }, [channel.port2]);
      });
      setPreviewStatus("connected");
    } catch (error) { setPreviewStatus("disconnected"); setOutput(String(error)); }
  };

  const runCommand = async () => {
    const channel = new MessageChannel();
    setOutput("Running in guest…");
    channel.port1.onmessage = ({ data }) => {
      setOutput(data.error || `${data.stdout}${data.stderr}\nExit: ${data.code}`);
      channel.port1.close();
    };
    runtime.current?.contentWindow?.postMessage({ source: "preview-bridge", request: { type: "exec", command } }, location.origin, [channel.port2]);
  };

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.source !== "qemu-runtime") return;
      setStatus(event.data.status);
      setDetail(event.data.detail);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  const start = () => {
    setPreviewStatus("disconnected");
    setStatus("loading");
    setDetail("Loading the pinned QEMU, kernel, and Alpine disk artifacts…");
    setBootKey((value) => value + 1);
  };

  return (
    <main className="shell">
      <header>
        <div>
          <p className="eyebrow">QEMU-Wasm v0</p>
          <h1>Browser coding workspace</h1>
        </div>
        <div className={`status status-${status}`}><span />{labels[status]}</div>
      </header>

      <section className="toolbar">
        <button onClick={start} disabled={!isolated || status === "loading"}>
          {artifactsReady ? <RotateCcw size={16} /> : <Play size={16} />}
          {artifactsReady ? "Restart VM" : "Start VM"}
        </button>
        <p>{detail}</p>
      </section>

      {!isolated && (
        <div className="warning">
          This page is not cross-origin isolated. Run it through <code>bun run dev</code> or a server that sends COOP/COEP headers.
        </div>
      )}

      <section className="workspace">
        <div className="pane terminal-pane">
          <div className="pane-title"><TerminalSquare size={15} />Guest serial console</div>
          {bootKey === 0 ? (
            <div className="empty">Start the VM, wait for <code>demo login:</code>, then sign in as <code>root</code>.</div>
          ) : (
            <iframe ref={runtime} key={bootKey} title="QEMU serial console" src="/runtime.html" />
          )}
        </div>
        <div className="pane preview-pane">
          <div className="pane-title">
            Application preview · {previewStatus}
            {previewStatus === "connected" && <button onClick={() => { if (preview.current) preview.current.src = "/__guest/"; }}>Reload preview</button>}
          </div>
          {previewStatus === "connected" ? <iframe ref={preview} title="Guest application preview" src="/__guest/" /> : (
            <div className="empty">
              <span>Start guest Vite on 127.0.0.1:5173 in the background, then return to the shell prompt.</span>
              <button disabled={status !== "running" || previewStatus === "connecting"} onClick={connectPreview}>Connect preview</button>
              {output && <span role="alert">{output}</span>}
            </div>
          )}
        </div>
      </section>

      {previewStatus === "connected" && <section className="guest-command">
        <form onSubmit={(event) => { event.preventDefault(); void runCommand(); }}>
          <input aria-label="Guest command" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Shell command in /workspace" />
          <button type="submit">Run in guest</button>
        </form>
        <pre>{output}</pre>
      </section>}

      <footer>
        x86-64 Alpine · 512 MB guest RAM · QEMU TCG/Wasm JIT · ephemeral overlay filesystem
      </footer>
    </main>
  );
}

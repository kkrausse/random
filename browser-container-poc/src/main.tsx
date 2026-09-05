import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Play, RotateCcw, TerminalSquare } from "lucide-react";
import "./styles.css";

type RuntimeStatus = "idle" | "loading" | "running" | "error";

const labels: Record<RuntimeStatus, string> = {
  idle: "Not started",
  loading: "Loading VM",
  running: "QEMU running",
  error: "Runtime error",
};

function App() {
  const [status, setStatus] = useState<RuntimeStatus>("idle");
  const [bootKey, setBootKey] = useState(0);
  const [detail, setDetail] = useState("Ready to allocate the browser VM.");
  const isolated = window.crossOriginIsolated;
  const artifactsReady = status !== "idle" || bootKey > 0;

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
            <iframe key={bootKey} title="QEMU serial console" src="/runtime.html" />
          )}
        </div>
        <div className="pane preview-pane">
          <div className="pane-title">Application preview</div>
          <div className="empty">
            <strong>Next milestone</strong>
            <span>Install pinned Bun + OpenCode in the guest image, then bridge Vite HTTP and HMR here.</span>
          </div>
        </div>
      </section>

      <footer>
        x86-64 Alpine · 512 MB guest RAM · QEMU TCG/Wasm JIT · ephemeral overlay filesystem
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

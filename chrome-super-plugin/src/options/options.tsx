import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { Keyboard } from "lucide-react";
import { DEFAULT_FEATURES, FEATURES, getFeatures, onFeaturesChanged, setFeature, type FeatureState } from "../features";

// Keyboard-first: focus starts on the first switch, ↑/↓ (or j/k, Tab) move,
// Space/Enter toggles, 1–4 toggle a feature directly, Esc closes the tab.

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-md border border-keycap-border bg-keycap px-1.5 font-sans text-[12px] font-medium text-muted shadow-[0_1px_0_var(--keycap-shadow)]">
      {children}
    </kbd>
  );
}

async function closeTab() {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
  else window.close();
}

function Options() {
  const [features, setFeatures] = useState<FeatureState>(DEFAULT_FEATURES);
  const [loaded, setLoaded] = useState(false);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    void getFeatures().then((state) => {
      setFeatures(state);
      setLoaded(true);
    });
    onFeaturesChanged((next) => setFeatures(next));
  }, []);

  // Focus the first switch once the real state is shown.
  useEffect(() => {
    if (loaded) rows.current[0]?.focus();
  }, [loaded]);

  function toggle(index: number) {
    const feature = FEATURES[index];
    if (!feature || !loaded) return;
    const next = !features[feature.id];
    setFeatures({ ...features, [feature.id]: next });
    void setFeature(feature.id, next);
    rows.current[index]?.focus();
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const focused = rows.current.findIndex((row) => row === document.activeElement);
      if (event.key === "Escape") {
        event.preventDefault();
        void closeTab();
      } else if (/^[1-9]$/.test(event.key) && Number(event.key) <= FEATURES.length) {
        event.preventDefault();
        toggle(Number(event.key) - 1);
      } else if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        rows.current[Math.min(FEATURES.length - 1, focused + 1)]?.focus();
      } else if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        rows.current[Math.max(0, focused - 1)]?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <main className="mx-auto max-w-xl px-6 py-10 text-fg">
      <h1 className="text-[22px] font-semibold">Super Extension</h1>
      <p className="mt-1 text-[14px] text-muted">Turn each feature on or off. Off means off: its scripts, shortcut, menus and connections stop working.</p>

      <ul className="mt-6 flex flex-col gap-2" aria-label="Features">
        {FEATURES.map((feature, index) => {
          const on = features[feature.id];
          return (
            <li key={feature.id}>
              <button
                ref={(el) => { rows.current[index] = el; }}
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() => toggle(index)}
                className="group flex w-full items-center gap-4 rounded-xl border border-line bg-surface px-4 py-3.5 text-left outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 focus:border-accent focus:ring-2 focus:ring-accent/40"
              >
                <Kbd>{String(index + 1)}</Kbd>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2 text-[15px] font-medium">
                    {feature.title}
                    {feature.shortcut && <span className="text-[12px] font-normal text-muted">{feature.shortcut}</span>}
                  </span>
                  <span className="text-[13px] text-muted">{feature.description}</span>
                </span>
                <span
                  aria-hidden
                  className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-chip"}`}
                >
                  <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                </span>
                <span className={`w-7 text-right text-[12px] font-medium ${on ? "text-accent" : "text-muted"}`}>{on ? "On" : "Off"}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-muted">
        <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
        <span className="flex items-center gap-1.5"><Kbd>Space</Kbd> toggle</span>
        <span className="flex items-center gap-1.5"><Kbd>1</Kbd>–<Kbd>{String(FEATURES.length)}</Kbd> toggle directly</span>
        <span className="flex items-center gap-1.5"><Kbd>Esc</Kbd> close</span>
      </div>

      <button
        type="button"
        onClick={() => void chrome.tabs.create({ url: "chrome://extensions/shortcuts" })}
        className="mt-8 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/40"
      >
        <Keyboard className="size-4" /> Change keyboard shortcuts (chrome://extensions/shortcuts)
      </button>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Options />);

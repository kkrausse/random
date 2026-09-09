import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceEditing, type WorkspaceController } from "@kev-browser-agent-kit/workspace/react";
import SampleApp from "./SampleApp";
import { Button } from "./components/ui/button";
import { recordControllerDiagnostic } from "./workspace-provider";
import type Editor from "./editor";
import type { createSampleRecipe } from "./sample-recipe";

function App() {
  const [allowed, setAllowed] = useState(false), [enabled, setEnabled] = useState(false);
  const [retryKey, retry] = useState(0), [closing, setClosing] = useState(false), [error, setError] = useState("");
  const [loaded, setLoaded] = useState<{ Editor: typeof Editor; recipe: ReturnType<typeof createSampleRecipe> }>();
  useEffect(() => { let active = true; void fetch("/editing-policy").then(response => response.json()).then(policy => { if (active) setAllowed(policy.allowed === true); }).catch(() => {}); return () => { active = false; }; }, []);
  const start = async (controller: WorkspaceController) => {
    const [editor, recipeModule] = await Promise.all([import("./editor"), import("./sample-recipe")]);
    controller.signal.throwIfAborted();
    const recipe = recipeModule.createSampleRecipe();
    setLoaded({ Editor: editor.default, recipe });
    await recipe.start(controller);
  };
  return <WorkspaceEditing allowed={allowed} enabled={enabled} retryKey={retryKey} start={start} isPreviewReady={state => state.clients.vite === "ready"} onDiagnostic={recordControllerDiagnostic} renderEditor={({ controller, state, active }) => {
    const exit = () => {
      setEnabled(false); setClosing(true); setError("");
      void controller.cancelAndClose().catch(reason => setError(String(reason))).finally(() => setClosing(false));
    };
    return <>
      {active && loaded && <loaded.Editor recipe={loaded.recipe} exit={exit} retry={() => retry(value => value + 1)} />}
      {allowed && (!active || !loaded) && (enabled || closing || !!error) && <aside className="fixed bottom-4 right-4 z-20 border bg-white p-3 space-y-2">
        <p className="text-sm">Local editor mode</p>
        {enabled && <Button onClick={exit}>Cancel editing startup</Button>}
        {enabled && state.error && <><p role="alert">{state.error}</p><Button onClick={() => retry(value => value + 1)}>Retry editing</Button></>}
        {error && <><p role="alert">{error}</p><Button onClick={exit}>Retry Exit</Button></>}
      </aside>}
    </>;
  }}><SampleApp editorControl={allowed
    ? <Button id="start-sample" disabled={enabled || closing || !!error} onClick={() => { setError(""); setEnabled(true); }}>{closing ? "Closing workspace…" : enabled ? "Starting workspace…" : "Local editor mode"}</Button>
    : <p className="sample-label">Editing is disabled on this server. Start the local demo with LOCAL_EDITOR_ADMIN=1 to enable the editor.</p>
  } /></WorkspaceEditing>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

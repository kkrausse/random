import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { useWorkspace } from "@vivari/workspace-api/react";
import { FileEditor, Preview, Chat } from "./editor-components";
import { Button } from "./components/ui/button";
import type { createSampleRecipe } from "./sample-recipe";

export default function Editor({ exit, retry, recipe }: { exit(): void; retry(): void; recipe: ReturnType<typeof createSampleRecipe> }) {
  const { controller, state } = useWorkspace();
  const [dirty, setDirty] = useState(false);
  const [expanded, setExpanded] = useState(false), [chatOpen, setChatOpen] = useState(true);
  return <>
    <Preview />
    <aside aria-label="Editing controls" className="fixed bottom-4 right-4 z-20 max-w-[calc(100vw-2rem)] space-y-3 border bg-white p-3" style={{ width: expanded ? 720 : 420, maxHeight: "90vh", overflow: "auto" }}>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setChatOpen(value => !value)} aria-expanded={chatOpen}>Chat</Button>
        <Button onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>Editor</Button>
        <Button disabled={state.busy || !state.runtime} onClick={() => void controller.run("Reset source", async () => { setDirty(false); await recipe.reset(controller); })}><RotateCcw />Reset source</Button>
        <Button onClick={exit}>Exit</Button>
      </div>
      <p id="status" role="status">{state.status}</p>
      {state.error && <><p role="alert" className="border border-red-300 bg-red-50 p-3 whitespace-pre-wrap">{state.error}</p><Button disabled={state.busy} onClick={retry}>Retry editing</Button></>}
      <p id="lifecycle" className="text-sm">Workspace: {state.workspace ? `open · ${state.persistence}` : "closed"} | Runtime: {state.runtime ? "active" : "stopped"}</p>
      <div hidden={!chatOpen}><Chat /></div>
      <div hidden={!expanded}><FileEditor dirty={dirty} setDirty={setDirty} />
        <p className="text-sm">Reset source intentionally replaces index.html, src/main.tsx, src/App.tsx and vite.config.mjs. Exit discards unsaved editor text; saved source and chat are retained.</p>
        <details><summary>Activity</summary><pre id="logs" className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{state.logs.join("\n")}</pre><a href="/diagnostics" download>Download diagnostics</a></details>
      </div>
    </aside>
  </>;
}

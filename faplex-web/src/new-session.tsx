import { apiFetch } from "./endpoint";
import { useEffect, useState } from "react";
import { Loader } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { HARNESS_LABEL } from "./format.ts";
import { openSession } from "./router.ts";
import type { Harness, WatchState } from "./types.ts";

// `faplex new --background`: with a prompt it starts working and shows up in the list; with none
// it is an empty chat, opened straight away.
export function NewSession({ open, onOpenChange, state }: { open: boolean; onOpenChange: (open: boolean) => void; state: WatchState }) {
  const [machine, setMachine] = useState(state.lastPick?.machine ?? state.machines[0]?.id ?? "local");
  const [harness, setHarness] = useState<Harness>(state.lastPick?.harness ?? "claude");
  const [dir, setDir] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const m = state.machines.find((x) => x.id === machine);
  const problem = (h: Harness) => state.sources.find((s) => s.machine === machine && s.harness === h)?.problem;
  // A stopped daemon is started by the harness's own CLI; missing or failing ones can't be used.
  const usable = (h: Harness) => {
    const p = problem(h);
    return !p || p.kind === "stopped";
  };

  useEffect(() => {
    if (open) {
      setDir(m?.dir ?? "~");
      setPrompt("");
    }
  }, [open, machine]);

  async function start() {
    setBusy(true);
    try {
      const r = await apiFetch("/api/new", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ machine, harness, dir, prompt }),
      });
      const res = (await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))) as { ok: boolean; key?: string; error?: string };
      if (!res.ok) return void toast.error("Could not start", { description: res.error, duration: 8000 });
      onOpenChange(false);
      if (!prompt.trim() && res.key) openSession(res.key);
      else toast.success("Started", { description: `${HARNESS_LABEL[harness]} on ${machine}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="mx-auto w-full max-w-lg">
          <DrawerHeader>
            <DrawerTitle>New session</DrawerTitle>
            <DrawerDescription>Without a prompt it opens as an empty chat.</DrawerDescription>
          </DrawerHeader>
          <div className="space-y-3 px-4">
            <ToggleGroup value={[machine]} onValueChange={(v: string[]) => v[0] && setMachine(v[0])} variant="outline" spacing={1} className="flex-wrap">
              {state.machines.map((x) => (
                <ToggleGroupItem key={x.id} value={x.id}>
                  <span className="size-1.5 rounded-full" style={{ background: x.color }} />
                  {x.id}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <ToggleGroup value={[harness]} onValueChange={(v: string[]) => v[0] && setHarness(v[0] as Harness)} variant="outline" spacing={1} className="flex-wrap">
              {state.harnesses.map((h) => (
                <ToggleGroupItem key={h} value={h} disabled={!usable(h)} title={problem(h)?.message}>
                  {HARNESS_LABEL[h]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="Start folder" className="font-mono text-base" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Prompt (optional)" rows={4} className="text-base" />
          </div>
          <DrawerFooter>
            <Button size="lg" onClick={() => void start()} disabled={busy || !usable(harness)}>
              {busy && <Loader className="animate-spin" />}
              {prompt.trim() ? "Start" : "Open empty chat"}
            </Button>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

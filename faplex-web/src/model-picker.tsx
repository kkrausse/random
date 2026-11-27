// OpenCode sessions: pick the model (and its effort) from a list, instead of OpenCode's own menus,
// which need keyboard shortcuts a phone doesn't have and lag far from diesel2. The server asks
// OpenCode's API (/api/models, /api/model); a pick applies at once, to the session's next turn.
import { useEffect, useMemo, useState } from "react";
import { Check, Loader } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { apiFetch } from "./endpoint";

type Model = { id: string; providerID: string; name: string; variants: string[] };
type Current = { id: string; providerID: string; variant?: string } | null;
const RECENT_KEY = "faplex.recentModels";
const recent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; } };
const ref = (m: { providerID: string; id: string }) => `${m.providerID}/${m.id}`;

export function ModelPicker({ sessionKey, open, onOpenChange }: { sessionKey: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [models, setModels] = useState<Model[] | null>(null);
  const [current, setCurrent] = useState<Current>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    apiFetch(`/api/models?key=${encodeURIComponent(sessionKey)}`)
      .then((r) => r.json())
      .then((b: { models?: Model[]; current?: Current; error?: string }) => {
        if (b.error) setError(b.error);
        else { setModels(b.models ?? []); setCurrent(b.current ?? null); }
      })
      .catch((e) => setError(String(e)));
  }, [open, sessionKey]);

  const pick = async (m: Model, variant?: string) => {
    const v = variant ?? (current && ref(current) === ref(m) ? current.variant : undefined);
    setBusy(ref(m) + (v ?? ""));
    try {
      const r = await apiFetch("/api/model", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: sessionKey, providerID: m.providerID, id: m.id, variant: v }) });
      const b = (await r.json()) as { ok: boolean; error?: string };
      if (!b.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
      setCurrent({ id: m.id, providerID: m.providerID, variant: v });
      localStorage.setItem(RECENT_KEY, JSON.stringify([ref(m), ...recent().filter((x) => x !== ref(m))].slice(0, 6)));
      toast.success(`${m.name}${v ? ` · ${v}` : ""}`, { duration: 1500 });
    } catch (e) {
      toast.error("Couldn't switch the model", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const shown = useMemo(() => {
    if (!models) return [];
    const q = query.trim().toLowerCase();
    const match = (m: Model) => !q || `${m.name} ${m.id} ${m.providerID}`.toLowerCase().includes(q);
    const rec = recent();
    const recents = rec.map((r) => models.find((m) => ref(m) === r)).filter((m): m is Model => !!m && match(m));
    const rest = models.filter((m) => match(m) && !rec.includes(ref(m))).sort((a, b) => a.providerID.localeCompare(b.providerID) || b.name.localeCompare(a.name, undefined, { numeric: true })); // newest first
    return [...(recents.length ? [{ title: "Recent", items: recents }] : []), ...groupBy(rest)];
  }, [models, query]);

  const currentModel = current && models?.find((m) => ref(m) === ref(current));
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="faplex max-h-[80dvh] gap-2 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <SheetHeader className="pb-0">
          <SheetTitle>Model</SheetTitle>
          <p className="text-xs text-muted-foreground">{current ? `Now: ${currentModel?.name ?? current.id}${current.variant ? ` · ${current.variant}` : ""}` : "Now: OpenCode's default"} · applies from the next message</p>
        </SheetHeader>
        {currentModel && currentModel.variants.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4">
            {currentModel.variants.map((v) => (
              <button key={v} type="button" onClick={() => pick(currentModel, v)}
                className={cn("rounded-full border px-3 py-1 text-xs", current?.variant === v ? "border-primary bg-primary/15" : "border-border text-muted-foreground")}>
                {busy === ref(currentModel) + v ? <Loader className="inline size-3 animate-spin" /> : v}
              </button>
            ))}
          </div>
        )}
        <div className="px-4"><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search models" className="h-9 text-base" /></div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2">
          {error && <p className="p-2 text-sm text-red-400">{error}</p>}
          {!models && !error && <div className="grid place-items-center p-6"><Loader className="size-5 animate-spin text-muted-foreground" /></div>}
          {shown.map((g) => (
            <div key={g.title} className="mb-2">
              <div className="px-2 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{g.title}</div>
              {g.items.map((m) => {
                const on = !!current && ref(current) === ref(m);
                return (
                  <button key={ref(m)} type="button" onClick={() => pick(m)} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-left active:bg-muted", on && "bg-muted")}>
                    <span className="min-w-0 flex-1"><span className="block truncate">{m.name}</span><span className="block truncate text-[11px] text-muted-foreground">{m.providerID}</span></span>
                    {busy?.startsWith(ref(m)) ? <Loader className="size-4 animate-spin" /> : on && <Check className="size-4 text-primary" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function groupBy(models: Model[]) {
  const out: { title: string; items: Model[] }[] = [];
  for (const m of models) {
    const g = out.at(-1);
    if (g && g.title === m.providerID) g.items.push(m);
    else out.push({ title: m.providerID, items: [m] });
  }
  return out;
}

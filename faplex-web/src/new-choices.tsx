// What + starts, chosen ahead of time (kept on this device): the harness / machine, and that
// harness's model and effort. The server lists the choices (/api/choices: Claude's aliases,
// OpenCode's API, Codex's own list) and `faplex new --model --effort` passes them each harness's
// own way, so nothing is typed into the session.
import { useEffect, useMemo, useState } from "react";
import { Check, Loader } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { apiFetch } from "./endpoint";
import { HARNESS_LABEL } from "./format.ts";
import type { Harness } from "./types.ts";

export type Option = { machine: string; harness: Harness; color: string };
export type ModelPick = { model?: string; effort?: string; name?: string };
type Choice = { id: string; name: string; efforts: string[] };

const pickKey = (o: { machine: string; harness: string }) => `faplex.newModel.${o.machine}/${o.harness}`;
export const modelPickFor = (o: { machine: string; harness: string } | undefined): ModelPick => {
  if (!o) return {};
  try { return JSON.parse(localStorage.getItem(pickKey(o)) ?? "{}"); } catch { return {}; }
};

export function NewChoices({ open, onOpenChange, options, pick, onPick, onMore }: {
  open: boolean; onOpenChange: (o: boolean) => void; options: Option[]; pick: Option | undefined;
  onPick: (o: Option) => void; onMore: () => void;
}) {
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mp, setMp] = useState<ModelPick>(() => modelPickFor(pick));

  useEffect(() => {
    if (!open || !pick) return;
    setChoices(null); setError(null); setQuery(""); setMp(modelPickFor(pick));
    apiFetch(`/api/choices?machine=${encodeURIComponent(pick.machine)}&harness=${encodeURIComponent(pick.harness)}`)
      .then((r) => r.json())
      .then((b: { models?: Choice[]; error?: string }) => { if (b.error) setError(b.error); setChoices(b.models ?? []); })
      .catch((e) => setError(String(e)));
  }, [open, pick?.machine, pick?.harness]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (next: ModelPick) => { if (!pick) return; setMp(next); localStorage.setItem(pickKey(pick), JSON.stringify(next)); };
  const model = choices?.find((c) => c.id === mp.model);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (choices ?? []).filter((c) => !q || `${c.name} ${c.id}`.toLowerCase().includes(q));
  }, [choices, query]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="faplex max-h-[85dvh] gap-2 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <SheetHeader className="pb-0"><SheetTitle>What + starts</SheetTitle></SheetHeader>
        <div className="flex flex-wrap gap-1.5 px-4">
          {options.map((o) => (
            <button key={`${o.machine}/${o.harness}`} type="button" onClick={() => onPick(o)}
              className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm", o === pick ? "border-primary bg-primary/15" : "border-border text-muted-foreground")}>
              <span className="size-1.5 rounded-full" style={{ background: o.color }} />{HARNESS_LABEL[o.harness]}{options.some((x) => x.machine !== o.machine) && <span className="text-xs text-muted-foreground">{o.machine}</span>}
            </button>
          ))}
        </div>
        <div className="px-4 pt-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Effort</div>
        <div className="flex flex-wrap gap-1.5 px-4">
          <button type="button" onClick={() => save({ ...mp, effort: undefined })} className={cn("rounded-full border px-3 py-1 text-xs", !mp.effort ? "border-primary bg-primary/15" : "border-border text-muted-foreground")}>default</button>
          {(model?.efforts ?? []).map((e) => (
            <button key={e} type="button" onClick={() => save({ ...mp, effort: e })} className={cn("rounded-full border px-3 py-1 text-xs", mp.effort === e ? "border-primary bg-primary/15" : "border-border text-muted-foreground")}>{e}</button>
          ))}
          {!model && <span className="self-center text-xs text-muted-foreground">pick a model for its efforts</span>}
        </div>
        <div className="px-4 pt-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Model</div>
        {(choices?.length ?? 0) > 8 && <div className="px-4"><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search models" className="h-9 text-base" /></div>}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2">
          {error && <p className="p-2 text-sm text-red-400">{error}</p>}
          {!choices && !error && <div className="grid place-items-center p-4"><Loader className="size-5 animate-spin text-muted-foreground" /></div>}
          {choices && (
            <button type="button" onClick={() => save({})} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-left active:bg-muted", !mp.model && "bg-muted")}>
              <span className="flex-1">Default</span>{!mp.model && <Check className="size-4 text-primary" />}
            </button>
          )}
          {shown.map((c) => (
            <button key={c.id} type="button" onClick={() => save({ model: c.id, name: c.name, effort: mp.effort && c.efforts.includes(mp.effort) ? mp.effort : undefined })}
              className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-left active:bg-muted", mp.model === c.id && "bg-muted")}>
              <span className="min-w-0 flex-1 truncate">{c.name}</span>{mp.model === c.id && <Check className="size-4 text-primary" />}
            </button>
          ))}
        </div>
        <button type="button" onClick={onMore} className="mx-4 rounded-md border border-border py-2 text-sm text-muted-foreground">More options (folder, prompt)…</button>
      </SheetContent>
    </Sheet>
  );
}

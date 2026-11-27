import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Loader, Plus, Search, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { groupOf, HARNESS_LABEL, type Group } from "./format.ts";
import type { useLive } from "./live.ts";
import { NewSession, startEmpty, startable } from "./new-session.tsx";
import { modelPickFor, NewChoices } from "./new-choices.tsx";
import { SessionCard } from "./session-card.tsx";
import type { Harness, Session } from "./types.ts";
import { CloseToMap } from "./walks-panel";

const SECTIONS: { group: Exclude<Group, "archived">; label: string; accent: string }[] = [
  { group: "needs", label: "Needs input", accent: "text-amber-400" },
  { group: "working", label: "Working", accent: "text-sky-400" },
  { group: "finished", label: "Finished", accent: "text-emerald-400" },
];

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function SessionList({ live }: { live: ReturnType<typeof useLive> }) {
  const { state, status, error, warm } = live;
  const now = useNow(15_000);
  const [machine, setMachine] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  // What + starts: chosen ahead of time in the ▾ menu (kept on this device), else faplex's last pick.
  const [chosen, setChosen] = useState<{ machine: string; harness: Harness } | null>(() => { try { return JSON.parse(localStorage.getItem("faplex.newPick") ?? "null"); } catch { return null; } });
  const options = state ? startable(state) : [];
  const pick = options.find((o) => o.machine === chosen?.machine && o.harness === chosen?.harness)
    ?? options.find((o) => o.machine === state?.lastPick?.machine && o.harness === state?.lastPick?.harness) ?? options[0];
  const choose = (o: { machine: string; harness: Harness }) => { setChosen(o); localStorage.setItem("faplex.newPick", JSON.stringify({ machine: o.machine, harness: o.harness })); };
  const [choicesOpen, setChoicesOpen] = useState(false);
  const quick = () => {
    if (!pick) return setNewOpen(true);
    setStarting(true);
    const mp = modelPickFor(pick);
    void startEmpty(pick.machine, pick.harness, undefined, { model: mp.model, effort: mp.effort }).finally(() => setStarting(false));
  };

  const machines = new Map(state?.machines.map((m) => [m.id, m]));
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (state?.sessions ?? []).filter(
      (s) => (machine === "all" || s.machine === machine) && (!q || `${s.title} ${s.detail} ${s.cwd} ${s.tags.join(" ")}`.toLowerCase().includes(q)),
    );
  }, [state, machine, query]);
  const groups = useMemo(() => {
    const g: Record<Group, Session[]> = { needs: [], working: [], finished: [], archived: [] };
    for (const s of visible) g[groupOf(s)].push(s);
    // Failed turns lead Finished, as in faplex; otherwise the newest first.
    g.finished.sort((a, b) => Number(b.status === "failed") - Number(a.status === "failed") || b.updatedAt - a.updatedAt);
    return g;
  }, [visible]);
  // Reachability problems; a harness that simply isn't installed is not one.
  const problems = (state?.sources ?? []).filter((s) => s.problem && s.problem.kind !== "missing");
  const liveCount = groups.needs.length + groups.working.length + groups.finished.length;

  return (
    <div className="mx-auto min-h-dvh max-w-2xl pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 px-3 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2 backdrop-blur-md">
        <div className="flex h-10 items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">faplex</h1>
          <span
            className={cn("size-2 rounded-full", status === "live" ? "bg-emerald-400" : status === "connecting" ? "bg-amber-400 animate-pulse" : "bg-red-400")}
            title={status}
          />
          {groups.needs.length > 0 && <span className="text-sm text-amber-400">{groups.needs.length} waiting</span>}
          <div className="ml-auto flex items-center gap-1">
            <CloseToMap size="icon" />
            <Button variant="ghost" size="icon" aria-label="Search" onClick={() => (setSearching(!searching), setQuery(""))}>
              {searching ? <X /> : <Search />}
            </Button>
            {/* + opens a new empty session right away; the ▾ beside it (showing the harness) chooses ahead
                of time which harness / machine + uses, or opens the full form (folder, prompt). */}
            <div className="flex items-center">
              <Button size="icon" aria-label={pick ? `New ${HARNESS_LABEL[pick.harness]} session on ${pick.machine}` : "New session"} className="w-10 rounded-r-none" disabled={!state || starting} onClick={quick}>
                {starting ? <Loader className="animate-spin" /> : <Plus />}
              </Button>
              <Button size="sm" aria-label="What + starts" className="h-8 max-w-36 gap-1 rounded-l-none border-l border-primary-foreground/20 px-2.5 text-xs" disabled={!state || starting} onClick={() => setChoicesOpen(true)}>
                <span className="truncate">{pick ? `${HARNESS_LABEL[pick.harness]}${modelPickFor(pick).name ? ` · ${modelPickFor(pick).name!.split(" · ")[0]}` : ""}` : ""}</span><ChevronDown className="shrink-0" />
              </Button>
            </div>
          </div>
        </div>
        {searching && (
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by title, folder, tag…" className="mt-1 text-base" />
        )}
        {state && state.machines.length > 1 && (
          <ToggleGroup
            value={[machine]}
            onValueChange={(v: string[]) => setMachine(v[0] ?? "all")}
            size="sm"
            variant="outline"
            spacing={1}
            className="mt-1 overflow-x-auto"
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            {state.machines.map((m) => (
              <ToggleGroupItem key={m.id} value={m.id}>
                <span className="size-1.5 rounded-full" style={{ background: m.color }} />
                {m.id}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </header>

      <main className="space-y-5 px-3 pt-3">
        {error && (
          <p className="flex items-center gap-1.5 rounded-lg bg-red-400/10 px-3 py-2 text-xs text-red-300">
            <TriangleAlert className="size-3.5" />
            {error}
          </p>
        )}
        {problems.length > 0 && (
          <Collapsible className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
            <CollapsibleTrigger className="group/prob flex w-full items-center gap-1.5 text-left">
              <TriangleAlert className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {problems.length === 1 ? `${problems[0]!.machine} · ${HARNESS_LABEL[problems[0]!.harness]}: ${problems[0]!.problem!.message}` : `${problems.length} sources not reporting · ${[...new Set(problems.map((p) => p.machine))].join(", ")}`}
              </span>
              <ChevronDown className="size-3.5 shrink-0 transition-transform group-data-[panel-open]/prob:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1.5 space-y-1">
              {problems.map((p) => (
                <p key={`${p.machine}/${p.harness}`} className="flex gap-1.5">
                  <span className="shrink-0 font-medium">{p.machine} · {HARNESS_LABEL[p.harness]}</span>
                  <span className="min-w-0 break-words text-amber-200/70">{p.problem!.message}</span>
                </p>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}

        {!state &&
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}

        {state && liveCount === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">{query ? "Nothing matches." : "No open sessions. Start one with +."}</p>
        )}

        {SECTIONS.map(({ group, label, accent }) =>
          groups[group].length === 0 ? null : (
            <section key={group}>
              <h2 className={cn("mb-2 px-1 text-xs font-semibold tracking-wide uppercase", accent)}>
                {label} <span className="text-muted-foreground">{groups[group].length}</span>
              </h2>
              <div className="space-y-2">
                {groups[group].map((s) => (
                  <SessionCard key={s.key} session={s} machine={machines.get(s.machine)} now={now} warm={warm} />
                ))}
              </div>
            </section>
          ),
        )}

        {groups.archived.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="group/arch flex w-full items-center gap-1 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Archived <span>{machine === "all" && !query ? state!.archivedTotal : groups.archived.length}</span>
              <ChevronDown className="size-3.5 transition-transform group-data-[panel-open]/arch:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-2">
              {groups.archived.map((s) => (
                <SessionCard key={s.key} session={s} machine={machines.get(s.machine)} now={now} warm={warm} />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </main>

      {state && <NewSession open={newOpen} onOpenChange={setNewOpen} state={state} />}
      <NewChoices open={choicesOpen} onOpenChange={setChoicesOpen} options={options} pick={pick} onPick={choose} onMore={() => { setChoicesOpen(false); setNewOpen(true); }} />
    </div>
  );
}

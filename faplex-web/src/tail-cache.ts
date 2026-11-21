import { useEffect, useState } from "react";
import type { Session, TailMessage } from "./types.ts";

// Last messages per session, fetched when its card scrolls into view and again when it changes.
type Entry = { updatedAt: number; messages?: TailMessage[]; error?: string; loading: boolean };
const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

const notify = (key: string) => listeners.get(key)?.forEach((fn) => fn());

export function loadTail(s: Session, force = false) {
  const hit = cache.get(s.key);
  if (!force && hit && (hit.loading || hit.updatedAt === s.updatedAt)) return;
  cache.set(s.key, { ...hit, updatedAt: s.updatedAt, loading: true });
  notify(s.key);
  void fetch(`/api/tail?key=${encodeURIComponent(s.key)}&n=2`)
    .then((r) => r.json() as Promise<{ messages: TailMessage[]; error?: string }>)
    .then((body) => cache.set(s.key, { updatedAt: s.updatedAt, messages: body.messages, error: body.error, loading: false }))
    .catch((e) => cache.set(s.key, { updatedAt: s.updatedAt, error: String(e), loading: false }))
    .finally(() => notify(s.key));
}

export function useTail(key: string) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(fn);
    return () => void listeners.get(key)!.delete(fn);
  }, [key]);
  return cache.get(key);
}

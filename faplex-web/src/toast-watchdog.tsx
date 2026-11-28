// Sonner pauses a toast's timer while its stack is "hovered" or touched. On the phone a tap can
// leave that state on for good (iOS sends mouseenter with no mouseleave, or pointercancel instead
// of pointerup), and a "Copied" toast then stayed up forever (user, 11-28). This dismisses every
// toast once its own time is over, whatever sonner thinks; loading toasts are left alone.
import { useEffect, useRef } from "react";
import { toast, useSonner } from "sonner";

type Id = string | number;

export function ToastWatchdog() {
  const { toasts } = useSonner();
  const timers = useRef(new Map<Id, { key: string; t: ReturnType<typeof setTimeout> }>());
  useEffect(() => {
    const live = new Set<Id>();
    for (const t of toasts) {
      live.add(t.id);
      const cur = timers.current.get(t.id);
      if (t.type === "loading" || t.duration === Infinity) {
        if (cur) { clearTimeout(cur.t); timers.current.delete(t.id); }
        continue;
      }
      const key = `${t.type}|${String(t.title)}|${t.duration}`;
      if (cur?.key === key) continue;
      if (cur) clearTimeout(cur.t);
      const ms = (t.duration ?? 4000) + 1500;
      timers.current.set(t.id, { key, t: setTimeout(() => { timers.current.delete(t.id); toast.dismiss(t.id); }, ms) });
    }
    for (const [id, v] of timers.current) if (!live.has(id)) { clearTimeout(v.t); timers.current.delete(id); }
  }, [toasts]);
  return null;
}

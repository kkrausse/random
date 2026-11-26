// Embedded in another app (<FaplexEmbed onClose>), faplex's headers carry the way back: a chevron
// that calls the host's onClose. On faplex's own site there's nothing to close, so no button.
import { useSyncExternalStore } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

let close: (() => void) | null = null;
const listeners = new Set<() => void>();
export function setCloseHandler(fn: (() => void) | null) {
  if (fn === close) return;
  close = fn;
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

export function CloseToMap({ size = "icon-lg" }: { size?: "icon" | "icon-lg" }) {
  const onClose = useSyncExternalStore(subscribe, () => close);
  if (!onClose) return null;
  return (
    <Button variant="ghost" size={size} aria-label="Back to the map" onClick={onClose}>
      <ChevronDown className="size-5" />
    </Button>
  );
}

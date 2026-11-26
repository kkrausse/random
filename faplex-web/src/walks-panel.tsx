// Inside the Walks app (walk-planner), faplex runs in a full-screen panel over the map. The panel
// has no bar of its own, so faplex's header carries the way back: a chevron that asks the app to
// close the panel (walks://close-panel; the app intercepts that navigation). Dragging the header
// down also closes it.
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export const inWalksPanel = typeof navigator !== "undefined" && /WalksPanel\//.test(navigator.userAgent);

export function CloseToMap({ size = "icon-lg" }: { size?: "icon" | "icon-lg" }) {
  if (!inWalksPanel) return null;
  return (
    <Button variant="ghost" size={size} aria-label="Back to the map" onClick={() => { location.href = "walks://close-panel"; }}>
      <ChevronDown className="size-5" />
    </Button>
  );
}

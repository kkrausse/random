import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { useLive } from "./live.ts";
import { ToastWatchdog } from "./toast-watchdog.tsx";
import { keyFromPath, usePath } from "./router.ts";
import { SessionList } from "./session-list.tsx";
import { SessionScreen } from "./session-screen.tsx";

export function App() {
  const path = usePath();
  const live = useLive();
  const key = keyFromPath(path);
  return (
    <TooltipProvider>
      {/* The list stays mounted under a session so its scroll position and previews survive. */}
      <div className={key ? "hidden" : undefined}>
        <SessionList live={live} />
      </div>
      {key && <SessionScreen key={key} sessionKey={key} live={live} />}
      <Toaster position="top-center" />
      <ToastWatchdog />
    </TooltipProvider>
  );
}

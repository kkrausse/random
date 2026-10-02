import { createSignal } from "solid-js";

// Palette from paseo-tui / oc-plugin-session-manager.
export const colors = {
  bg: "#18181b",
  text: "#e4e4e7",
  muted: "#a1a1aa",
  dim: "#71717a",
  surfaceRaised: "#3f3f46",
  border: "#52525b",
  selected: "#fde047",
  selectedText: "#18181b",
  error: "#ef4444",
  permission: "#f59e0b",
  success: "#4ade80",
  claude: "#d97757",
  codex: "#e4e4e7",
  opencode: "#a78bfa",
};

export const providerColor = (p: string) => (colors as Record<string, string>)[p] ?? colors.muted;

// One shared ticker so every working row spins in step without per-row timers.
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const [tick, setTick] = createSignal(0);
setInterval(() => setTick((t) => (t + 1) % FRAMES.length), 80).unref?.();
export const spinner = () => FRAMES[tick()]!;

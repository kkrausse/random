import type { ColorInput } from "@opentui/core"

export interface SessionManagerPalette {
  text: ColorInput
  muted: ColorInput
  surface: ColorInput
  surfaceRaised: ColorInput
  border: ColorInput
  selected: ColorInput
  selectedText: ColorInput
  error: ColorInput
  permission: ColorInput
  question: ColorInput
}

const fallback: SessionManagerPalette = {
  text: "#e4e4e7",
  muted: "#a1a1aa",
  surface: "#18181b",
  surfaceRaised: "#3f3f46",
  border: "#52525b",
  selected: "#fde047",
  selectedText: "#18181b",
  error: "#ef4444",
  permission: "#f59e0b",
  question: "#38bdf8",
}

function color(theme: unknown, ...paths: string[][]): ColorInput | undefined {
  for (const path of paths) {
    let value: unknown = theme
    for (const key of path) {
      if (!value || typeof value !== "object") {
        value = undefined
        break
      }
      value = (value as Record<string, unknown>)[key]
    }
    if (value !== undefined && value !== null) return value as ColorInput
  }
}

/**
 * Isolates the picker from OpenCode's raw theme schema. Known public theme
 * generations are adapted defensively and every role has a local fallback.
 */
export function sessionManagerPalette(theme: unknown): SessionManagerPalette {
  return {
    text: color(theme, ["text", "base"], ["text", "default"]) ?? fallback.text,
    muted: color(theme, ["text", "muted"], ["text", "subdued"]) ?? fallback.muted,
    surface: color(theme, ["background", "raised", "base"], ["contextual", "overlay", "background", "default"]) ?? fallback.surface,
    surfaceRaised: color(theme, ["background", "raised", "high"], ["contextual", "overlay", "background", "surface", "offset"]) ?? fallback.surfaceRaised,
    border: color(theme, ["border", "base"], ["scrollbar", "base"], ["contextual", "overlay", "scrollbar", "default"]) ?? fallback.border,
    // Selection stays plugin-owned: some host themes intentionally map their
    // accent ramp to grey, which removes the picker's strongest focus cue.
    selected: fallback.selected,
    selectedText: color(theme, ["background", "base"], ["contextual", "overlay", "background", "default"]) ?? fallback.selectedText,
    error: color(theme, ["text", "feedback", "error", "base"], ["text", "feedback", "error", "default"]) ?? fallback.error,
    permission: color(theme, ["text", "feedback", "warning", "base"], ["text", "status", "permission"]) ?? fallback.permission,
    question: color(theme, ["text", "feedback", "info", "base"], ["text", "status", "question"]) ?? fallback.question,
  }
}

import { groupLabel, type SessionState } from "./session-groups"

type Option = { value: string; state: SessionState | "new" }

// Choose before the lifecycle update re-sorts the list. Attention states share
// one displayed section, so compare section labels rather than raw states.
export function sectionNeighbor(options: readonly Option[], value: string) {
  const index = options.findIndex((option) => option.value === value)
  if (index < 0) return undefined
  const section = groupLabel(options[index]!.state)
  return [options[index + 1], options[index - 1]].find((option) => option && groupLabel(option.state) === section)
    ?.value
}

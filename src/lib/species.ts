import { Species } from "./fuzzy";
import speciesData from "@/data/species.json";

export type { Species };

export function loadSpecies(): Species[] {
  return speciesData as Species[];
}

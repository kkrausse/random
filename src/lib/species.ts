import fs from "fs";
import path from "path";
import { Species } from "./fuzzy";

export type { Species };

let speciesCache: Species[] | null = null;

export function loadSpecies(): Species[] {
  if (speciesCache) return speciesCache;
  const filePath = path.join(process.cwd(), "data", "species.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  speciesCache = JSON.parse(raw) as Species[];
  return speciesCache;
}

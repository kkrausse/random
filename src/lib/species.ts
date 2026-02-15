import fs from "fs";
import path from "path";

export interface Species {
  commonName: string;
  scientificName: string;
  speciesCode: string;
}

let speciesCache: Species[] | null = null;

function loadSpecies(): Species[] {
  if (speciesCache) return speciesCache;
  const filePath = path.join(process.cwd(), "data", "species.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  speciesCache = JSON.parse(raw) as Species[];
  return speciesCache;
}

export function searchSpecies(query: string, limit = 10): Species[] {
  const species = loadSpecies();
  const q = query.toLowerCase();
  const results: Species[] = [];
  for (const s of species) {
    if (
      s.commonName.toLowerCase().includes(q) ||
      s.scientificName.toLowerCase().includes(q)
    ) {
      results.push(s);
      if (results.length >= limit) break;
    }
  }
  return results;
}

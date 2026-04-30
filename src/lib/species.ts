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

export function searchSpecies(query: string, limit = 10, offset = 0): Species[] {
  const species = loadSpecies();
  const q = query.toLowerCase().replace(/[\s-]+/g, "");
  const results: Species[] = [];
  let skipped = 0;
  for (const s of species) {
    const commonNormalized = s.commonName.toLowerCase().replace(/[\s-]+/g, "");
    const scientificNormalized = s.scientificName.toLowerCase().replace(/[\s-]+/g, "");
    if (
      commonNormalized.includes(q) ||
      scientificNormalized.includes(q)
    ) {
      if (skipped < offset) {
        skipped++;
        continue;
      }
      results.push(s);
      if (results.length >= limit) break;
    }
  }
  return results;
}

export function countSpecies(query: string): number {
  const species = loadSpecies();
  const q = query.toLowerCase().replace(/[\s-]+/g, "");
  let count = 0;
  for (const s of species) {
    const commonNormalized = s.commonName.toLowerCase().replace(/[\s-]+/g, "");
    const scientificNormalized = s.scientificName.toLowerCase().replace(/[\s-]+/g, "");
    if (
      commonNormalized.includes(q) ||
      scientificNormalized.includes(q)
    ) {
      count++;
    }
  }
  return count;
}

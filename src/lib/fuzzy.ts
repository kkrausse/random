export interface Species {
  commonName: string;
  scientificName: string;
  speciesCode: string;
}

// Returns null if query chars don't all appear in text in order.
// Higher scores = better match. Tiers: exact (10000), prefix (9000),
// substring (8000), fuzzy char-sequence (<700).
function fuzzyScore(text: string, query: string): number | null {
  const t = text.toLowerCase().replace(/[\s-]+/g, "");
  const q = query.toLowerCase().replace(/[\s-]+/g, "");
  if (!q) return 0;

  if (t === q) return 10000;
  if (t.startsWith(q)) return 9000 - t.length;

  const subIdx = t.indexOf(q);
  if (subIdx !== -1) return 8000 - subIdx * 2 - t.length;

  // Fuzzy: all query chars must appear in order; score by consecutive runs
  let score = 0;
  let ti = 0;
  let qi = 0;
  let run = 0;
  let firstMatch = -1;

  while (ti < t.length && qi < q.length) {
    if (t[ti] === q[qi]) {
      if (firstMatch === -1) firstMatch = ti;
      run++;
      score += 10 + run * 5;
      qi++;
    } else {
      run = 0;
    }
    ti++;
  }

  if (qi < q.length) return null;

  score -= firstMatch * 2;
  score -= t.length;
  return score;
}

function scoreSpecies(s: Species, query: string): number | null {
  const commonScore = fuzzyScore(s.commonName, query);
  const sciScore = fuzzyScore(s.scientificName, query);
  // Common name matches get a +100 bias
  const best = Math.max(
    commonScore !== null ? commonScore + 100 : -Infinity,
    sciScore !== null ? sciScore : -Infinity,
  );
  return isFinite(best) ? best : null;
}

export function searchSpeciesFuzzy(species: Species[], query: string, limit = 50): Species[] {
  if (!query.trim()) return [];
  return species
    .map(s => ({ s, score: scoreSpecies(s, query) }))
    .filter((x): x is { s: Species; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.s);
}

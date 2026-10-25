// Small fuzzy matcher: every query character must appear in order. Matches
// at word starts and consecutive runs score higher; a plain substring match
// gets a big bonus so "close" beats "c-l-o-s-e spread across a title".

export interface FuzzyResult {
  score: number;
  // Indexes into the target string that matched, for highlighting.
  matches: number[];
}

function isWordStart(text: string, index: number) {
  if (index === 0) return true;
  const prev = text[index - 1];
  return /[\s\-_/.:([]/.test(prev) || (/[a-z]/.test(prev) && /[A-Z]/.test(text[index]));
}

export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, matches: [] };
  const lower = target.toLowerCase();

  const substring = lower.indexOf(q);
  if (substring >= 0) {
    const matches = Array.from({ length: q.length }, (_, i) => substring + i);
    const startBonus = isWordStart(target, substring) ? 30 : 0;
    return { score: 100 + startBonus - substring * 0.5 - target.length * 0.05, matches };
  }

  // Every word of a multi-word query matching somewhere ("tab close").
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const matches: number[] = [];
    let score = 60;
    for (const word of words) {
      const at = lower.indexOf(word);
      if (at < 0) {
        score = -1;
        break;
      }
      for (let i = 0; i < word.length; i++) matches.push(at + i);
      if (isWordStart(target, at)) score += 5;
    }
    if (score > 0) return { score, matches: matches.sort((a, b) => a - b) };
  }

  const matches: number[] = [];
  let score = 0;
  let ti = 0;
  let prevMatch = -2;
  const compact = q.replace(/\s+/g, "");
  for (const char of compact) {
    let found = -1;
    // Prefer the next word-start occurrence, otherwise the next occurrence.
    for (let i = ti; i < lower.length; i++) {
      if (lower[i] === char && isWordStart(target, i)) {
        found = i;
        break;
      }
    }
    const plain = lower.indexOf(char, ti);
    if (plain < 0) return null;
    if (found < 0 || (plain === prevMatch + 1)) found = plain;
    score += 1;
    if (isWordStart(target, found)) score += 8;
    if (found === prevMatch + 1) score += 5;
    else score -= Math.min(found - ti, 6) * 0.5;
    matches.push(found);
    prevMatch = found;
    ti = found + 1;
  }
  // Scattered letters ("p…i…n" across "Copy as Markdown link") aren't a
  // match worth showing; require mostly word starts or runs.
  if (score < compact.length * 3) return null;
  return { score: score - target.length * 0.02, matches };
}

// Best match across several fields (title, keywords, url); later fields are
// discounted and don't produce highlights on the title.
export function fuzzyBest(query: string, fields: (string | undefined)[]): FuzzyResult | null {
  let best: FuzzyResult | null = null;
  fields.forEach((field, index) => {
    if (!field) return;
    const result = fuzzyMatch(query, field);
    if (!result) return;
    // Keywords and URLs only count on whole-substring / word matches.
    if (index > 0 && result.score < 60) return;
    const adjusted = index === 0 ? result : { score: result.score * 0.7 - 2, matches: [] };
    if (!best || adjusted.score > best.score) best = adjusted;
  });
  return best;
}

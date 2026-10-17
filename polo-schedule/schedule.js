export const ZONE = 'America/Los_Angeles';
export const NAMES = { polo: 'Polo Field · cycling', kezar: 'Kezar · running' };

// Deliberately simple CSV: no quoted fields or embedded commas. Windows use ;.
export function parseCSV(text) {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  if (header !== 'venue,date,windows,checked,source,note') throw Error('Unexpected CSV header');
  const seen = new Set();
  return lines.filter(Boolean).map(line => {
    const fields = line.split(',');
    if (fields.length !== 6) throw Error('Expected six CSV fields');
    const [venue, date, windows, checked, source, note] = fields;
    if (!NAMES[venue] || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(checked) || !source.startsWith('https://sfrecpark.org/')) throw Error('Invalid CSV row');
    const key = `${venue}/${date}`;
    if (seen.has(key)) throw Error('Duplicate schedule day');
    seen.add(key);
    const intervals = windows ? windows.split(';').map(window => {
      const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(window);
      if (!match) throw Error('Invalid window');
      const [, ah, am, bh, bm] = match.map(Number);
      const start = ah * 60 + am, end = bh * 60 + bm;
      if (ah > 23 || am > 59 || bh > 24 || bm > 59 || (bh === 24 && bm !== 0) || start >= end) throw Error('Invalid time');
      return { start, end };
    }) : [];
    for (let i = 1; i < intervals.length; i++) if (intervals[i].start < intervals[i - 1].end) throw Error('Overlapping or unsorted windows');
    return { venue, date, intervals, checked, source, note };
  });
}

export function localNow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: +parts.hour * 60 + +parts.minute };
}

export function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isStale(row, date) { return date > addDays(row.checked, 7); }
export function timeLabel(minute) {
  if (minute === 1440) return 'end of day';
  const hour = Math.floor(minute / 60);
  return `${hour % 12 || 12}:${String(minute % 60).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
}

export function status(rows, venue, now = new Date()) {
  const { date, minute } = localNow(now);
  const row = rows.find(r => r.venue === venue && r.date === date);
  if (!row || isStale(row, date)) return { state: 'unknown', label: row ? 'Stale schedule' : 'Unknown', detail: 'Check the official schedule.' };
  const active = row.intervals.find(w => minute >= w.start && minute < w.end);
  if (active) return { state: 'open', label: 'Scheduled open', detail: `Until ${timeLabel(active.end)} today.` };
  const next = rows.filter(r => r.venue === venue && r.date >= date && !isStale(r, date))
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap(r => r.intervals.map(w => ({ ...w, date: r.date })))
    .find(w => w.date > date || w.start > minute);
  return { state: 'closed', label: 'Not scheduled open', detail: next ? `Next listed opening: ${next.date === date ? 'today' : next.date} at ${timeLabel(next.start)}.` : 'No next opening in saved data.' };
}

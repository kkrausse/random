import { NAMES, ZONE, parseCSV, localNow, addDays, isStale, timeLabel, status } from './schedule.js';
let rows = [];
let error = '';
function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
function render() {
  const now = new Date(), { date } = localNow(now);
  document.querySelector('#clock').textContent = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE, weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  }).format(now);
  document.querySelector('#message').textContent = error;
  const cards = document.querySelector('#now');
  cards.replaceChildren();
  for (const venue of ['polo', 'kezar']) {
    const current = status(rows, venue, now), card = element('article', '');
    card.append(element('h2', NAMES[venue]), element('p', current.label, `status ${current.state}`), element('p', current.detail));
    const row = rows.find(r => r.venue === venue && r.date === date);
    card.append(element('p', row ? `Source checked ${row.checked}${isStale(row, date) ? ' · stale' : ''}` : 'No saved data for today', 'muted'));
    cards.append(card);
  }
  const body = document.querySelector('#days');
  body.replaceChildren();
  for (let i = 0; i < 7; i++) {
    const day = addDays(date, i), tr = element('tr', '');
    tr.append(element('th', i === 0 ? 'Today' : new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))));
    for (const venue of ['polo', 'kezar']) {
      const row = rows.find(r => r.date === day && r.venue === venue), td = element('td', '');
      if (!row) td.append(element('div', 'Unknown · needs update'));
      else {
        if (isStale(row, date)) td.append(element('div', 'Stale · verify source', 'closed'));
        for (const w of row.intervals) td.append(element('div', `${timeLabel(w.start)} – ${timeLabel(w.end)}`));
        if (!row.intervals.length) td.append(element('div', 'No scheduled open times'));
        if (row.note) td.append(element('div', row.note, 'muted'));
      }
      tr.append(td);
    }
    body.append(tr);
  }
}
async function load() {
  try {
    // version.json names the content-hashed CSV (see build.ts); unbuilt checkouts have neither.
    const version = await fetch('version.json', { cache: 'no-store' });
    const csv = version.ok ? (await version.json()).csv : 'schedule.csv';
    const response = await fetch(csv, { cache: 'no-store' });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    rows = parseCSV(await response.text());
    error = '';
  } catch {
    rows = [];
    error = 'Could not load the schedule. Use the official links below.';
  }
  render();
}
load();
setInterval(render, 60_000);
setInterval(load, 15 * 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

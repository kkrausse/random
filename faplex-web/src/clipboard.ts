// Copying text out of faplex. On its own site: the browser's clipboard. Embedded in an app whose
// page has no navigator.clipboard (Walks' walk-planner:// page), the host passes its own writer
// (<FaplexEmbed copyText>), e.g. the native pasteboard.
let writer: ((text: string) => Promise<unknown>) | null = null;

export const setCopyWriter = (w: typeof writer) => { writer = w; };

export async function copyText(text: string) {
  if (writer) return void (await writer(text));
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const area = Object.assign(document.createElement("textarea"), { value: text, readOnly: true });
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.append(area);
  area.select();
  try { if (!document.execCommand("copy")) throw new Error("copy was refused"); } finally { area.remove(); }
}

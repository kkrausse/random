// Append-only cumulative transcript policy, as used by the local Hex fork.
// Keep raw prefix validation separate from terminal-safe normalization.
export function terminalText(text: string) {
  return text.replace(/[\r\n\t\u2028\u2029]/g, " ").replace(/[\x00-\x1f\x7f-\x9f]/g, "");
}

export class TranscriptPipeline {
  private observed = "";
  private released = 0;
  private finished = false;
  diverged = false;
  preview = "";

  accept(text: string, final = false) {
    if (this.finished) return "";
    if (!text.startsWith(this.observed)) this.diverged = true;
    this.observed = text;
    const safe = terminalText(text);
    this.finished = final;
    if (this.diverged) { this.preview = safe; return ""; }
    let end = safe.length;
    if (!final) {
      end = this.released;
      for (let i = this.released; i < safe.length; i++) if (/\s/u.test(safe[i]!)) end = i + 1;
    }
    const delta = safe.slice(this.released, end);
    this.released = end;
    this.preview = safe.slice(end);
    return delta;
  }
}

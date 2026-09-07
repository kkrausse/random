// Audited OpenTUI 0.4.5 adapter. Native getText only copies into outPtr
// synchronously (no retention/callback); the JS result is an owned slice.
export const originalTextRead = `  editBufferGetText(buffer, maxLength) {
    const outBuffer = new Uint8Array(maxLength);
    const actualLen = this.opentui.symbols.editBufferGetText(buffer, ptrOrNull(outBuffer), maxLength);
    const len = actualLen;
    if (len === 0)
      return null;
    return outBuffer.slice(0, len);
  }`;

export const scratchTextRead = originalTextRead.replace(
  '    const outBuffer = new Uint8Array(maxLength);',
  `    if (!this.vivariTextScratch || this.vivariTextScratch.length < maxLength)
      this.vivariTextScratch = new Uint8Array(Math.max(maxLength, (this.vivariTextScratch?.length || 0) * 2));
    const outBuffer = this.vivariTextScratch;`,
);

export function adaptTextRead(source: string) {
  if (source.split(originalTextRead).length !== 2) throw Error('OpenTUI text-read adapter drift: expected exactly one audited method');
  return source.replace(originalTextRead, scratchTextRead);
}

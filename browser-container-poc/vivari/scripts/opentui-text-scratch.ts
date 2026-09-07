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
  `    maxLength = Math.min(maxLength, this.opentui.symbols.textBufferGetByteSize(this.opentui.symbols.editBufferGetTextBuffer(buffer)));
    if (!this.vivariTextScratch || this.vivariTextScratch.length < maxLength)
      this.vivariTextScratch = new Uint8Array(Math.max(maxLength, (this.vivariTextScratch?.length || 0) * 2));
    const outBuffer = this.vivariTextScratch;`,
);

// Native yoga.zig writes six scalars synchronously; the returned object owns
// its values. No callbacks, retained out pointer, or shared returned view.
export const originalLayoutRead = `  yogaNodeGetComputedLayout(node) {
    const layout = new Float32Array(6);
    this.opentui.symbols.yogaNodeGetComputedLayout(node, ptr(layout));
    return {
      left: layout[0],
      top: layout[1],
      right: layout[2],
      bottom: layout[3],
      width: layout[4],
      height: layout[5]
    };
  }`;
export const scratchLayoutRead = originalLayoutRead.replace(
  'const layout = new Float32Array(6);',
  'const layout = this.vivariLayoutScratch ||= new Float32Array(6);',
);

export function adaptTextRead(source: string) {
  if (source.split(originalTextRead).length !== 2) throw Error('OpenTUI text-read adapter drift: expected exactly one audited method');
  return source.replace(originalTextRead, scratchTextRead);
}

export function adaptLayoutRead(source: string) {
  if (source.split(originalLayoutRead).length !== 2) throw Error('OpenTUI layout-read adapter drift: expected exactly one audited method');
  return source.replace(originalLayoutRead, scratchLayoutRead);
}

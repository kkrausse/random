import assert from 'node:assert/strict';
import { defineStruct } from 'bun-ffi-structs';
import { RGBA, Audio } from '@opentui/core';
import layout from '../../.runtime/ffi-layout-report.json';

export function qualifyAbi(lib, report) {
  assert.throws(() => Audio.create(), /Audio createAudioEngine returned null/);
  for (const record of layout.records) {
    const packed = defineStruct(record.fields);
    assert.equal(packed.size, record.wireSize, record.name + ' guest size');
    assert.deepEqual(record.fields.map(([name]) => packed.layoutByName.get(name).offset), record.wireOffsets, record.name + ' guest offsets');
  }
  report('TUI_LAYOUT_PASS ' + JSON.stringify(layout.records.map(r => [r.name, r.wireSize])) + '\n');
  const decode = bytes => new TextDecoder().decode(bytes);
  // Multiple chunks, UTF-8 byte lengths, nullable colors and retained text owners.
  for (let cycle = 0; cycle < 3; cycle++) {
    const tb = lib.createTextBuffer('unicode');
    const view = lib.createTextBufferView(tb.ptr);
    const edit = lib.createEditBuffer('unicode');
    const editor = lib.createEditorView(edit, 12, 3);
    try {
      lib.textBufferSetStyledText(tb.ptr, [{text:'héllo ', fg:RGBA.fromHex('#00ff00'), link:{url:'https://example.com'}}, {text:'世界\nsecond'}]);
      assert.equal(decode(lib.getPlainTextBytes(tb.ptr, 100)), 'héllo 世界\nsecond');
      lib.textBufferViewSetWrapWidth(view, 40);
      let lines = lib.textBufferViewGetLogicalLineInfo(view);
      assert.deepEqual(Array.from(lines.lineWidthCols), [10, 6]);
      lib.editorViewSetPlaceholderStyledText(editor, [{text:'placeholder ', fg:RGBA.fromHex('#ff0000')}, {text:'two'}]);
      lib.editBufferInsertText(edit, 'one\ntwo');
      assert.equal(decode(lib.editorViewGetText(editor, 100)), 'one\ntwo');
      assert.deepEqual(Array.from(lib.editorViewGetLogicalLineInfo(editor).lineWidthCols), [3,3]);
      assert.equal(lib.editorViewGetViewport(editor).width, 12);
      // Force text/native buffer growth after the earlier returned-array reads.
      lib.textBufferSetStyledText(tb.ptr, [{text:'x'.repeat(70000) + '\nlast'}]);
      assert.equal(lib.textBufferGetByteSize(tb.ptr), 70005);
      lines = lib.textBufferViewGetLogicalLineInfo(view);
      // Native display widths saturate at u16; text bytes remain complete.
      assert.deepEqual(Array.from(lines.lineWidthCols), [65535,4]);
    } finally {
      lib.destroyEditorView(editor); lib.destroyEditBuffer(edit);
      lib.destroyTextBufferView(view); tb.destroy();
    }
  }
  const native = lib.createRenderer(30, 4);
  assert.ok(native);
  try {
    lib.processCapabilityResponse(native, '\x1bP>|wire-terminal 1.2\x1b\\');
    const caps = lib.getTerminalCapabilities(native);
    assert.ok(JSON.stringify(caps).includes('wire-terminal'), JSON.stringify(caps));
    lib.setCursorStyleOptions(native, {style:'bar', blinking:false, color:RGBA.fromHex('#ff0000')});
    const cursor = lib.getCursorState(native);
    assert.equal(cursor.color.r, 1);
  } finally { lib.destroyRenderer(native); }
  const feed = lib.createNativeSpanFeed({chunkSize:64, initialChunks:2});
  try {
    const reserved = lib.streamReserve(feed, 8);
    assert.equal(reserved.status, 0); assert.ok(reserved.info.ptr); assert.ok(reserved.info.len >= 8);
    assert.equal(lib.streamCommitReserved(feed, 0), 0);
    assert.equal(lib.streamWrite(feed, 'span-wire'), 0);
    assert.equal(lib.streamCommit(feed), 0);
    const record = layout.records.find(r=>r.name === 'SpanInfoStruct');
    const output = new Uint8Array(record.wireSize * 4);
    assert.equal(lib.streamDrainSpans(feed, output, 4), 1);
    const unpacked = defineStruct(record.fields).unpack(output.buffer);
    assert.ok(unpacked.chunkPtr); assert.equal(unpacked.len, 9);
  } finally { lib.destroyNativeSpanFeed(feed); }
  report('TUI_ABI_PASS multi-chunk/unicode/link/colors/line-arrays/cursor/capabilities/span/reserve/growth/recreate\n');
}

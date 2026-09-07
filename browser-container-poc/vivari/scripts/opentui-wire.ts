// Build-time mixed-width wire ABI for the unchanged TypeScript wasm32 packer.
// Only the exported boundary changes; renderer-internal pointers remain wasm32.
export function adaptWire(source: string, textBuffer: string) {
  const types = ['ExternalCapabilities']
  let appended = ''
  for (const name of [...types, 'StyledChunk']) {
    const input = name === 'StyledChunk' ? textBuffer : source
    const body = input.match(new RegExp(`pub const ${name} = extern struct \\{([\\s\\S]*?)\\n\\};`))?.[1]
    if (!body) throw Error(`Missing ABI declaration ${name}`)
    const fields = [...body.matchAll(/^\s*(\w+): ([^,=]+)(?: = [^,]+)?,/gm)].map(m => ({name:m[1]!, type:m[2]!.trim()}))
    const native = name === 'StyledChunk' ? 'text_buffer.StyledChunk' : name
    appended += `\nconst Wire${name} = extern struct {\n${fields.map(f => `    ${f.name}: ${f.type.includes('*') ? 'u32' : f.type === 'usize' ? 'u64' : f.type},`).join('\n')}\n};\n`
    const checks = name === 'StyledChunk' ? `wireRange(wire.text_ptr, wire.text_len); wireRange(wire.link_ptr, wire.link_len);
      if (wire.fg_ptr != 0) wireRange(wire.fg_ptr, 8);
      if (wire.bg_ptr != 0) wireRange(wire.bg_ptr, 8);
      if (wire.fg_ptr % 2 != 0 or wire.bg_ptr % 2 != 0) @panic("OpenTUI unaligned color pointer");` : ''
    appended += `fn decode${name}(wire: Wire${name}) ${native} { ${checks} return .{\n${fields.map(f => `.${f.name} = ${f.name === 'text_ptr' ? 'if (wire.text_ptr == 0) EMPTY_U8[0..].ptr else @ptrFromInt(wire.text_ptr)' : f.type.includes('*') ? `@ptrFromInt(wireNarrow(wire.${f.name}))` : f.type === 'usize' ? `wireNarrow(wire.${f.name})` : `wire.${f.name}`},`).join('\n')}\n}; }\n`
    appended += `fn encode${name}(value: ${native}) Wire${name} { return .{\n${fields.map(f => `.${f.name} = ${f.type.includes('*') ? `@intFromPtr(value.${f.name})` : `value.${f.name}`},`).join('\n')}\n}; }\n`
  }
  appended += '\nfn wireNarrow(value: u64) u32 { return std.math.cast(u32, value) orelse @panic("OpenTUI wire pointer/length exceeds wasm32"); }\n'
  appended += '\nfn wireRange(pointer: u32, length: u64) void { const len = wireNarrow(length); if ((pointer == 0 and len != 0) or @as(u64, pointer) + len > @as(u64, @wasmMemorySize(0)) * 65536) @panic("OpenTUI wire range outside linear memory"); }\n'
  // Single input or output records. No native function retains these containers.
  source = source.replace(/export fn (\w+)\(([^)]*)\) (\w+) \{/g, (full, name, params, result) => {
    const type = types.find(t => params.includes(`*${t}`) || params.includes(`*const ${t}`))
    if (!type) return full
    const match = params.match(new RegExp(`(\\w+): \\*(const )?${type}`))!
    const arg = match[1], isInput = !!match[2]
    const wireParams = params.replace(`*${isInput ? 'const ' : ''}${type}`, `*${isInput ? 'const ' : ''}Wire${type}`)
    const args = params.split(',').map((p:string) => p.trim().split(':')[0]).filter(Boolean).map((p:string) => p === arg ? '&native' : p).join(', ')
    appended += `\nexport fn ${name}(${wireParams}) ${result} {\nvar native: ${type} = ${isInput ? `decode${type}(${arg}.*)` : 'undefined'};\n${result === 'void' ? '' : 'const result = '}internal_${name}(${args});\n${isInput ? '' : `${arg}.* = encode${type}(native);`}\n${result === 'void' ? '' : 'return result;'}\n}\n`
    return full.replace('export fn '+name, 'fn internal_'+name)
  })
  for (const name of ['textBufferSetStyledText', 'editorViewSetPlaceholderStyledText']) {
    source = source.replace(`export fn ${name}(`, `fn internal_${name}(`)
    appended += `\nexport fn ${name}(handle: NativeHandle, ptr: ?[*]const WireStyledChunk, count: u32) void {
      wireRange(@intFromPtr(ptr), @as(u64, count) * @sizeOf(WireStyledChunk));
      const chunks = globalAllocator.alloc(text_buffer.StyledChunk, count) catch @panic("OpenTUI wire allocation failed");
      defer globalAllocator.free(chunks);
      if (count > 0) { const input = ptr orelse @panic("OpenTUI null styled chunks");
        for (chunks, 0..) |*chunk, i| chunk.* = decodeStyledChunk(input[i]); }
      internal_${name}(handle, chunks.ptr, count);
    }\n`
  }
  return source + appended
}

export function unavailableAudio(block: string) {
  // Preserve scalar signatures; no unavailable operation dereferences pointees.
  return [...block.matchAll(/export fn (\w+)\(([\s\S]*?)\) ([\w?]+) \{/g)].map(m => {
    const params = m[2]!.replace(/\?\*(?:const )?native_audio\.\w+/g, '?*const anyopaque')
    const names = params.split(',').map(p=>p.trim().split(':')[0]).filter(Boolean)
    return `export fn ${m[1]}(${params}) ${m[3]} {\n${names.map(n=>`_ = ${n};`).join('\n')}\n${m[1] === 'createAudioEngine' ? 'return INVALID_HANDLE;' : '@panic("OpenTUI audio unavailable in the WASI renderer profile");'}\n}`
  }).join('\n')
}

// I/O adapter only: editing, motions, undo and screen layout belong to js-vim.
const fs = require('fs');
const EditorEngine = require('js-vim');
const editor = new EditorEngine();
const filename = process.argv[2];
if (!filename) throw Error('Usage: node editor-sidequest.cjs FILE');
const doc = new editor.Doc();
doc.path = filename;
doc.text(fs.readFileSync(filename, 'utf8'));
editor.add(doc);
let saved = doc.text();
let closing = false;
function render() {
  if (closing) return;
  // Ex key buffers include their terminating newline; never scroll the screen
  // by emitting a twentieth row into a nineteen-row terminal.
  const lines = editor.view.getText().split('\n').slice(0, editor.view.lines);
  process.stdout.write('\x1b[H\x1b[2J' + lines.join('\r\n'));
}
function resize() {
  editor.view.cols = process.stdout.columns || 80;
  editor.view.lines = process.stdout.rows || 24;
  // Reset upstream cached viewport when shrinking.
  editor.view.lastVisibleLines = [0, 1];
  render();
}
function quit(force) {
  if (!force && doc.text() !== saved) return editor.notify('Unsaved changes; :w or :q!');
  closing = true;
  process.stdout.write('\x1b[?25h\x1b[?1049l');
  process.exit(0);
}
editor.addCommand({ mode: 'command', match: /^:w\n$/, fn() {
  try {
    fs.writeFileSync(filename, doc.text(), 'utf8');
    saved = doc.text();
    editor.notify('"' + filename + '" written');
  } catch (error) { editor.notify(String(error)); }
} });
editor.addCommand({ mode: 'command', match: /^:q\n$/, fn() { quit(false); } });
editor.addCommand({ mode: 'command', match: /^:q!\n$/, fn() { quit(true); } });
editor.addCommand({ mode: 'command', match: /^:wq\n$/, fn() { editor.exec(':w\n'); quit(false); } });
process.stdout.write('\x1b[?1049h\x1b[?25l');
editor.view.on('change', render);
process.stdout.on('resize', resize);
process.on('SIGINT', () => editor.exec('esc'));
// Narrow ASCII/vi-key qualification. Escape sequences/arrows/paste are not parsed.
process.stdin.on('data', data => {
  for (const key of data.toString()) {
    editor.exec(key === '\x1b' ? 'esc' : key === '\x7f' ? '\b' : key === '\r' ? '\n' : key);
  }
});
resize();

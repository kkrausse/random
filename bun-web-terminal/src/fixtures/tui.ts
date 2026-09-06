// Deterministic full-screen workload for attachment and resize regression tests.
process.stdin.setRawMode(true);
let count = 0;
let resizes = 0;
function draw() {
  process.stdout.write(`\x1b[2J\x1b[HATTACHMENT-FIXTURE count=${count} size=${process.stdout.columns}x${process.stdout.rows} resizes=${resizes}`);
}
process.stdout.write("\x1b[?1049h\x1b[?2004h\x1b[?1000h\x1b[?1006h");
draw();
process.on("SIGWINCH", () => { resizes++; draw(); });
process.stdin.on("data", (data) => {
  for (const key of data.toString()) {
    if (key === "+") { count++; draw(); }
    if (key === "f") {
      process.stdout.write(("X".repeat(100) + "\r\n").repeat(12_000));
      draw();
    }
    if (key === "q") {
      process.stdout.write("\x1b[?1000l\x1b[?1006l\x1b[?2004l\x1b[?1049l");
      process.exit(0);
    }
  }
});

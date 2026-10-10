// Stays alive so the labelled link remains on screen.
process.stdout.write("\x1b[2J\x1b[H\x1b]8;;https://example.com/diagram\x07Open diagram\x1b]8;;\x07");
setInterval(() => {}, 1000);

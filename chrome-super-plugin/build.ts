import { cpSync, existsSync, mkdirSync, rmSync, watch, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = import.meta.dir;
const outdir = join(root, "dist");
const watchMode = process.argv.includes("--watch");

function tailwindBin() {
  const bin = join(root, "node_modules/.bin/tailwindcss");
  if (!existsSync(bin)) throw new Error("Tailwind CLI not found; run `bun install` in chrome-super-plugin/");
  return bin;
}

// Static files, copied flat into dist/ (the manifest and pages refer to
// them by bare name).
const ASSETS = [
  "manifest.json",
  "src/reading-context/sidepanel.html",
  "src/reading-context/sidepanel.css",
  "src/palette/palette.html",
  "src/options/options.html"
];

async function build(): Promise<boolean> {
  // Clean only on a one-off build: in watch mode a loaded extension keeps
  // reading dist/, so files are overwritten in place instead.
  if (!watchMode) rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });

  const result = await Bun.build({
    entrypoints: [
      join(root, "src/background.ts"),
      join(root, "src/reading-context/content.ts"),
      join(root, "src/reading-context/sidepanel.tsx"),
      join(root, "src/palette/palette.tsx"),
      join(root, "src/options/options.tsx"),
      join(root, "src/tab-search-guard/tab-search-guard.ts")
    ],
    outdir,
    target: "browser",
    format: "esm",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    naming: "[name].[ext]",
    minify: false,
    sourcemap: "external"
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    return false;
  }

  // Tailwind for the palette and options pages; the side panel keeps its
  // own hand-written CSS.
  const css = Bun.spawnSync(
    [tailwindBin(), "-i", join(root, "src/ui.css"), "-o", join(outdir, "ui.css"), "--minify"],
    { cwd: root, stdout: "ignore", stderr: "pipe" }
  );
  if (css.exitCode !== 0) {
    console.error(css.stderr.toString());
    return false;
  }

  for (const asset of ASSETS) {
    cpSync(join(root, asset), join(outdir, basename(asset)));
  }

  // Written last: the running extension polls this file and reloads itself
  // when it changes (see src/autoReload.ts).
  const buildId = `${new Date().toISOString()}-${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(join(outdir, "build-id.txt"), buildId);

  console.log(`Built ${result.outputs.length} scripts and ui.css in chrome-super-plugin/dist (build ${buildId})`);
  return true;
}

const ok = await build();

if (!watchMode) {
  if (!ok) process.exit(1);
} else {
  console.log("Watching for changes; the loaded extension reloads itself within ~30s (or when the palette opens).");
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let again = false;
  const rebuild = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      do {
        again = false;
        await build().catch((error) => console.error(error));
      } while (again);
      running = false;
    }, 150);
  };
  const watched = [
    join(root, "src"),
    join(root, "../boox-plugin-test/client/src"),
    join(root, "manifest.json")
  ];
  for (const path of watched) {
    if (existsSync(path)) watch(path, { recursive: true }, rebuild);
  }
}

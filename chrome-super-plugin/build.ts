import { cpSync, existsSync, mkdirSync, rmSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = import.meta.dir;
const outdir = join(root, "dist");
const watchMode = process.argv.includes("--watch");

// bun hoists the Tailwind CLI to the workspace root (boox-plugin-test/).
function tailwindBin() {
  const candidates = [join(root, "node_modules/.bin/tailwindcss"), join(root, "../node_modules/.bin/tailwindcss")];
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error("Tailwind CLI not found; run `bun install` in boox-plugin-test/");
  return found;
}

async function build(): Promise<boolean> {
  // Clean only on a one-off build: in watch mode a loaded extension keeps
  // reading dist/, so files are overwritten in place instead.
  if (!watchMode) rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });

  const result = await Bun.build({
    entrypoints: [
      join(root, "src/background.ts"),
      join(root, "src/content.ts"),
      join(root, "src/sidepanel.tsx"),
      join(root, "src/palette/palette.tsx")
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

  // The palette's styles; the side panel keeps its own hand-written CSS.
  const css = Bun.spawnSync(
    [tailwindBin(), "-i", join(root, "src/palette/styles.css"), "-o", join(outdir, "palette.css"), "--minify"],
    { cwd: root, stdout: "ignore", stderr: "pipe" }
  );
  if (css.exitCode !== 0) {
    console.error(css.stderr.toString());
    return false;
  }

  for (const asset of ["manifest.json", "sidepanel.css", "sidepanel.html", "palette.html"]) {
    cpSync(join(root, asset), join(outdir, asset));
  }

  // Written last: the running extension polls this file and reloads itself
  // when it changes (see src/autoReload.ts).
  const buildId = `${new Date().toISOString()}-${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(join(outdir, "build-id.txt"), buildId);

  console.log(`Built ${result.outputs.length} scripts and palette.css in chrome-plugin/dist (build ${buildId})`);
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
    join(root, "../client/src"),
    join(root, "manifest.json"),
    join(root, "sidepanel.css"),
    join(root, "sidepanel.html"),
    join(root, "palette.html")
  ];
  for (const path of watched) {
    if (existsSync(path)) watch(path, { recursive: true }, rebuild);
  }
}

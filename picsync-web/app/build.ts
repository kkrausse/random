const result = await Bun.build({
  entrypoints: [import.meta.dir + "/main.tsx"],
  outdir: import.meta.dir + "/dist",
  naming: "app.js",
  target: "browser",
  minify: true,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
if (!result.success) throw new AggregateError(result.logs, "Build failed");
const css = Bun.spawn(
  [
    "bunx",
    "--no-install",
    "@tailwindcss/cli",
    "-i",
    "app/style.css",
    "-o",
    "app/dist/app.css",
    "--minify",
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if (await css.exited) process.exit(1);

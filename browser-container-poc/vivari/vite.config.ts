import { defineConfig } from "vite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};
const dist = process.env.VIVARI_DIST
  ? pathToFileURL(resolve(process.env.VIVARI_DIST) + "/")
  : new URL("./node_modules/@vivari/core/dist/", import.meta.url);
const sw = () => readFileSync(new URL("assets/sw.js", dist));
const assets = new URL("assets/", dist);
export default defineConfig({
  resolve: process.env.VIVARI_DIST ? { alias: { "@vivari/core": new URL("index.js", dist).pathname } } : undefined,
  optimizeDeps: { exclude: ["@vivari/core"] },
  // Host source edits must not tear down an in-browser benchmark or agent run.
  server: { headers: isolation, hmr: false },
  preview: { headers: isolation },
  worker: { format: "es" },
  plugins: [{
    name: "vivari-service-worker",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const names = readdirSync(assets);
        const path = req.url?.split("?")[0];
        const name = path === "/sw.js" ? "sw.js" : path?.startsWith("/assets/") ? path.slice(8) : "";
        if (!name || !names.includes(name)) return next();
        for (const [key, value] of Object.entries(isolation)) res.setHeader(key, value);
        res.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : name.endsWith(".txt") ? "text/plain" : "text/javascript");
        res.end(readFileSync(new URL(name, assets)));
      });
    },
    generateBundle() {
      const names = readdirSync(assets);
      this.emitFile({ type: "asset", fileName: "sw.js", source: sw() });
      for (const name of names.filter(name => name !== "sw.js")) {
        this.emitFile({ type: "asset", fileName: `assets/${name}`, source: readFileSync(new URL(name, assets)) });
      }
    },
  }],
});

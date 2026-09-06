import { defineConfig } from "vite";
import { readFileSync, readdirSync } from "node:fs";

const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};
const sw = () => readFileSync(new URL("./node_modules/@vivari/core/dist/assets/sw.js", import.meta.url));
const assets = new URL("./node_modules/@vivari/core/dist/assets/", import.meta.url);
const names = readdirSync(assets);
export default defineConfig({
  optimizeDeps: { exclude: ["@vivari/core"] },
  // Host source edits must not tear down an in-browser benchmark or agent run.
  server: { headers: isolation, hmr: false },
  preview: { headers: isolation },
  worker: { format: "es" },
  plugins: [{
    name: "vivari-service-worker",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0];
        const name = path === "/sw.js" ? "sw.js" : path?.startsWith("/assets/") ? path.slice(8) : "";
        if (!name || !names.includes(name)) return next();
        for (const [key, value] of Object.entries(isolation)) res.setHeader(key, value);
        res.setHeader("Content-Type", "text/javascript");
        res.end(readFileSync(new URL(name, assets)));
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "sw.js", source: sw() });
      for (const name of names.filter(name => name !== "sw.js")) {
        this.emitFile({ type: "asset", fileName: `assets/${name}`, source: readFileSync(new URL(name, assets)) });
      }
    },
  }],
});

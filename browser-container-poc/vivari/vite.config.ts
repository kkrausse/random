import { defineConfig, loadEnv } from "vite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";

const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};
const env = loadEnv(process.env.NODE_ENV ?? 'development', import.meta.dirname, 'VIVARI_');
const runtimeDist = process.env.VIVARI_DIST ?? env.VIVARI_DIST;
const modelAuthFile = process.env.VIVARI_MODEL_AUTH_FILE ?? env.VIVARI_MODEL_AUTH_FILE;
// Explicit host-only opt-in. Never expose this value through VITE_* or the guest.
const modelKey = () => {
  if (!modelAuthFile) return 'public';
  const file = modelAuthFile.startsWith('~/') ? resolve(homedir(), modelAuthFile.slice(2)) : resolve(modelAuthFile);
  const auth = JSON.parse(readFileSync(file, 'utf8')).opencode;
  if (auth?.type !== 'api' || typeof auth.key !== 'string' || !auth.key) throw Error('Model proxy requires an OpenCode API-key entry');
  return auth.key as string;
};
const dist = runtimeDist
  ? pathToFileURL(resolve(runtimeDist) + "/")
  : new URL("./node_modules/@vivari/core/dist/", import.meta.url);
const sw = () => readFileSync(new URL("assets/sw.js", dist));
const assets = new URL("assets/", dist);
export default defineConfig({
  resolve: runtimeDist ? { alias: { "@vivari/core": new URL("index.js", dist).pathname } } : undefined,
  optimizeDeps: { exclude: ["@vivari/core"] },
  // Host source edits must not tear down an in-browser benchmark or agent run.
  server: {
    headers: isolation, hmr: false,
    // Dev-only CORS transport: one fixed model endpoint, streamed by Vite.
    // SDK/session/tool execution stays in the browser workers.
    proxy: {
      '^/__model/zen/chat/completions$': {
        target: 'https://opencode.ai', changeOrigin: true,
        rewrite: () => '/zen/v1/chat/completions',
        configure(proxy) {
          const key = modelKey();
          proxy.on('proxyReq', request => {
            request.setHeader('authorization', `Bearer ${key}`);
            request.removeHeader('cookie');
            request.removeHeader('origin');
            request.removeHeader('referer');
          });
        },
      },
    },
  },
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

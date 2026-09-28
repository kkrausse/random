import { defineConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const offline: Plugin = { name: "offline-precache", apply: "build", async closeBundle() {
  const files = await readdir("dist/assets");
  const sw = await readFile("dist/sw.js", "utf8");
  await writeFile("dist/sw.js", `self.__ASSETS=${JSON.stringify(["/", "/index.html", "/kings-beach.json", "/manifest.webmanifest", "/icon.svg", ...files.map(f => join("/assets", f))])};\n${sw}`);
} };
export default defineConfig({ plugins: [tailwindcss(), offline] });

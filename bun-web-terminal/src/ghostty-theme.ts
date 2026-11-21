import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

// The local Ghostty palette and font, for a browser terminal that looks like the desktop one.
// Shared with faplex-web.
export function loadGhosttyTheme() {
  const fallback = { background: "#282c34", foreground: "#ffffff" };
  const browserFont = process.env.TERMINAL_FONT ?? "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace";
  const scrollSensitivity = parseScrollSensitivity(process.env.TERMINAL_SCROLL_SENSITIVITY);
  const config = Bun.which("ghostty") ? showGhosttyConfig() : readGhosttyConfig();
  if (config === undefined) return { terminal: fallback, fontFamily: browserFont, fontSize: 14, scrollSensitivity };

  const values = new Map<string, string[]>();
  for (const line of config.split("\n")) {
    const match = line.match(/^([^#=]+?)\s*=\s*(.*)$/);
    if (match) values.set(match[1]!.trim(), [...(values.get(match[1]!.trim()) ?? []), match[2]!.trim()]);
  }
  const palette = new Map((values.get("palette") ?? []).map((entry) => entry.split("=", 2) as [string, string]));
  const colors = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;
  const terminal: Record<string, string> = {
    background: values.get("background")?.at(-1) || fallback.background,
    foreground: values.get("foreground")?.at(-1) || fallback.foreground,
  };
  colors.forEach((name, index) => {
    const normal = palette.get(String(index));
    const bright = palette.get(String(index + 8));
    if (normal) terminal[name] = normal;
    if (bright) terminal[`bright${name[0]!.toUpperCase()}${name.slice(1)}`] = bright;
  });
  const cursor = values.get("cursor-color")?.at(-1);
  const selection = values.get("selection-background")?.at(-1);
  if (cursor) terminal.cursor = cursor;
  if (selection) terminal.selectionBackground = selection;
  return {
    terminal,
    fontFamily: browserFont,
    fontSize: Number(values.get("font-size")?.at(-1)) || 14,
    scrollSensitivity,
  };
}

function showGhosttyConfig() {
  const defaults = Bun.spawnSync(["ghostty", "+show-config", "--default"], { stdout: "pipe", stderr: "ignore" });
  if (defaults.exitCode !== 0) return undefined;
  const overrides = Bun.spawnSync(["ghostty", "+show-config"], { stdout: "pipe", stderr: "ignore" });
  return `${defaults.stdout.toString()}\n${overrides.exitCode === 0 ? overrides.stdout.toString() : ""}`;
}

// A headless server has no Ghostty binary to resolve the config, so read the
// same files directly: the user config, its config-file includes, and the theme
// it names. Themes ship with the Ghostty app, so the ones in use are vendored.
function readGhosttyConfig() {
  const configDir = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "ghostty");
  const config = readGhosttyConfigFile(join(configDir, "config"), new Set());
  if (config === undefined) return undefined;
  const named = [...config.matchAll(/^theme\s*=\s*(.+)$/gm)].at(-1)?.[1]?.trim();
  const name = named?.match(/(?:^|,)\s*dark:([^,]+)/)?.[1]?.trim() ?? named;
  if (!name) return config;
  const themeDirs = [join(configDir, "themes"), join(import.meta.dir, "..", "themes")];
  const themePath = (isAbsolute(name) ? [name] : themeDirs.map((dir) => join(dir, name))).find((path) => existsSync(path));
  if (!themePath) {
    console.warn(`Ghostty theme "${name}" not found in ${themeDirs.join(" or ")}; using config colors only`);
    return config;
  }
  return `${readFileSync(themePath, "utf8")}\n${config}`;
}

function readGhosttyConfigFile(path: string, seen: Set<string>): string | undefined {
  if (seen.has(path) || !existsSync(path)) return undefined;
  seen.add(path);
  const text = readFileSync(path, "utf8");
  const includes = [...text.matchAll(/^config-file\s*=\s*(.+)$/gm)].map((match) => {
    const target = match[1]!.trim().replace(/^"(.*)"$/, "$1").replace(/^\?/, "");
    return target.startsWith("~/") ? join(homedir(), target.slice(2)) : resolve(dirname(path), target);
  });
  return [text, ...includes.map((include) => readGhosttyConfigFile(include, seen) ?? "")].join("\n");
}

function parseScrollSensitivity(value: string | undefined) {
  if (value === undefined || value === "") return 0.5;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 5) throw new Error(`Invalid TERMINAL_SCROLL_SENSITIVITY: ${value}`);
  return parsed;
}

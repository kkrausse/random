import { isAbsolute, relative, resolve } from "node:path";
import type { AppConfig } from "./types";

const configPath = resolve(process.env.VIDEO_EDITOR_CONFIG ?? "video-editor.config.json");

function isWithin(parent: string, child: string) {
  const pathFromParent = relative(parent, child);
  return pathFromParent === "" || (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent));
}

export async function loadConfig(): Promise<AppConfig> {
  const file = Bun.file(configPath);
  if (!(await file.exists())) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }

  const raw = (await file.json()) as AppConfig;
  const config: AppConfig = {
    ...raw,
    mediaRoot: resolve(process.env.MEDIA_ROOT ?? raw.mediaRoot),
    derivedRoot: resolve(process.env.DERIVED_ROOT ?? raw.derivedRoot),
    savedProjectsRoot: resolve(process.env.SAVED_PROJECTS_ROOT ?? raw.savedProjectsRoot),
  };

  if (!config.mediaRoot || !config.derivedRoot || !config.savedProjectsRoot || !config.ffmpegPath) {
    throw new Error("mediaRoot, derivedRoot, savedProjectsRoot, and ffmpegPath are required");
  }
  if (isWithin(config.mediaRoot, config.derivedRoot) || isWithin(config.derivedRoot, config.mediaRoot)) {
    throw new Error("derivedRoot and mediaRoot must not overlap");
  }
  if (isWithin(config.mediaRoot, config.savedProjectsRoot) || isWithin(config.savedProjectsRoot, config.mediaRoot)) {
    throw new Error("savedProjectsRoot and mediaRoot must not overlap");
  }
  if (isWithin(config.derivedRoot, config.savedProjectsRoot) || isWithin(config.savedProjectsRoot, config.derivedRoot)) {
    throw new Error("savedProjectsRoot and derivedRoot must not overlap");
  }
  if (config.proxy.maxHeight <= 0 || config.proxy.crf < 0 || config.proxy.crf > 51) {
    throw new Error("Invalid proxy configuration");
  }
  if (config.thumbnail.maxWidth <= 0 || config.thumbnail.quality < 1 || config.thumbnail.quality > 31) {
    throw new Error("Invalid thumbnail configuration");
  }
  if (config.export.quality < 0 || config.export.quality > 51) {
    throw new Error("Invalid export configuration");
  }
  if (config.export.concurrency !== undefined
    && (!Number.isInteger(config.export.concurrency) || config.export.concurrency < 1 || config.export.concurrency > 8)) {
    throw new Error("Export concurrency must be an integer between 1 and 8");
  }

  return config;
}

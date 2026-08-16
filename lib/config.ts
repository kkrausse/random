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
  };

  if (!config.mediaRoot || !config.derivedRoot) {
    throw new Error("mediaRoot and derivedRoot are required");
  }
  if (isWithin(config.mediaRoot, config.derivedRoot)) {
    throw new Error("derivedRoot must be outside mediaRoot to keep originals read-only");
  }
  if (config.proxy.maxHeight <= 0 || config.proxy.crf < 0 || config.proxy.crf > 51) {
    throw new Error("Invalid proxy configuration");
  }
  if (config.thumbnail.maxWidth <= 0 || config.thumbnail.quality < 1 || config.thumbnail.quality > 31) {
    throw new Error("Invalid thumbnail configuration");
  }

  return config;
}

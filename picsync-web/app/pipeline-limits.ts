const MB = 1024 * 1024;
const desktop = {
  workers: 10, downloads: 8, downloadBytes: 256 * MB,
  originalBytes: 192 * MB, previewBytes: 48 * MB,
  fullBytes: 256 * MB, fullCount: 3, prefetchFull: true, previewScreens: 2,
};
const ios = {
  workers: 1, downloads: 6, downloadBytes: 192 * MB,
  originalBytes: 32 * MB, previewBytes: 16 * MB,
  fullBytes: 384 * MB, fullCount: 3, prefetchFull: true, previewScreens: 2,
};
export type PipelineLimits = typeof desktop;
export function pipelineLimits(device: { userAgent: string; platform: string; maxTouchPoints: number } | undefined =
  typeof navigator === "undefined" ? undefined : navigator): PipelineLimits {
  const mobileApple = device && (/iPhone|iPad|iPod/.test(device.userAgent) ||
    (device.platform === "MacIntel" && device.maxTouchPoints > 1));
  return { ...(mobileApple ? ios : desktop) };
}

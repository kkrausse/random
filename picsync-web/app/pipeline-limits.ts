const MB = 1024 * 1024;
const desktop = {
  workers: 10, downloads: 8, downloadBytes: 256 * MB,
  originalBytes: 192 * MB, previewBytes: 48 * MB,
  fullBytes: 256 * MB, fullCount: 3, prefetchFull: true, previewMargin: 500,
};
const ios = {
  workers: 4, downloads: 2, downloadBytes: 64 * MB,
  originalBytes: 32 * MB, previewBytes: 16 * MB,
  fullBytes: 128 * MB, fullCount: 1, prefetchFull: false, previewMargin: 160,
};
export type PipelineLimits = typeof desktop;
export function pipelineLimits(device: { userAgent: string; platform: string; maxTouchPoints: number } | undefined =
  typeof navigator === "undefined" ? undefined : navigator): PipelineLimits {
  const mobileApple = device && (/iPhone|iPad|iPod/.test(device.userAgent) ||
    (device.platform === "MacIntel" && device.maxTouchPoints > 1));
  return { ...(mobileApple ? ios : desktop) };
}

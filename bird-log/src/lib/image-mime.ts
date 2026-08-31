export const IMAGE_MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
};

export function getImageContentType(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
  return IMAGE_MIME_TYPES[ext] || "application/octet-stream";
}

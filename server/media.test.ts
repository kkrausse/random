import { describe, expect, test } from "bun:test";
import type { MediaAsset } from "../lib/types";
import { paginateMedia } from "./media";

const media: MediaAsset[] = [
  { id: "clip2.mp4", filename: "clip2.mp4", relativePath: "clip2.mp4", kind: "video" },
  { id: "clip10.mp4", filename: "clip10.mp4", relativePath: "clip10.mp4", kind: "video" },
  { id: "photo.arw", filename: "photo.arw", relativePath: "photo.arw", kind: "photo" },
];

describe("media pagination", () => {
  test("excludes photos and returns cursor pages", () => {
    expect(paginateMedia(media, 1, null, false)).toEqual({ media: [media[0]], total: 2, nextCursor: "clip2.mp4" });
    expect(paginateMedia(media, 1, "clip2.mp4", false)).toEqual({ media: [media[1]], total: 2, nextCursor: null });
  });

  test("includes photos when requested and resumes after a missing cursor", () => {
    expect(paginateMedia(media, 10, null, true).total).toBe(3);
    expect(paginateMedia(media, 10, "clip3.mp4", false).media).toEqual([media[1]]);
  });
});

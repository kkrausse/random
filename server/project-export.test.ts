import { describe, expect, test } from "bun:test";
import type { AppConfig } from "../lib/types";
import {
  buildSegmentFilters,
  projectExportPath,
  ProjectExportValidationError,
  validateExportSettings,
  validateCropAspect,
  validateVideoTrim,
} from "./project-export";

describe("project export planning", () => {
  test("center-fills uncropped media and normalizes output", () => {
    expect(buildSegmentFilters({ width: 1920, height: 1080, fps: 30 })).toBe(
      "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,fps=30,format=yuv420p",
    );
  });

  test("applies normalized crop before output scaling", () => {
    const filters = buildSegmentFilters(
      { width: 1280, height: 720, fps: 29.97 },
      { x: 0.1, y: 0.2, width: 0.5, height: 0.5 },
    );
    expect(filters.startsWith("crop=")).toBe(true);
    expect(filters).toContain(",scale=1280:720,setsar=1,fps=29.97,format=yuv420p");
  });

  test("rejects unsafe output settings and trims", () => {
    expect(() => validateExportSettings({ width: 1921, height: 1080, fps: 30 })).toThrow(ProjectExportValidationError);
    expect(() => validateExportSettings({ width: 1920, height: 1080, fps: 241 })).toThrow(ProjectExportValidationError);
    expect(() => validateVideoTrim(0, 10.1, 10)).toThrow(ProjectExportValidationError);
    expect(() => validateVideoTrim(1, 2, 10)).not.toThrow();
  });

  test("rejects crops that would stretch into the project frame", () => {
    expect(() => validateCropAspect(
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      1920,
      1080,
      { width: 1080, height: 1080, fps: 30 },
    )).toThrow(ProjectExportValidationError);
    expect(() => validateCropAspect(
      { x: 0, y: 0.21875, width: 1, height: 0.5625 },
      1920,
      1080,
      { width: 1920, height: 1080, fps: 30 },
    )).toThrow(ProjectExportValidationError);
    expect(() => validateCropAspect(
      { x: 0.21875, y: 0, width: 0.5625, height: 1 },
      1920,
      1080,
      { width: 1080, height: 1080, fps: 30 },
    )).not.toThrow();
  });

  test("keeps project output under the project export directory", () => {
    const config = { derivedRoot: "/tmp/derived" } as AppConfig;
    expect(projectExportPath(config, "project_1")).toBe("/tmp/derived/exports/projects/project_1.mp4");
    expect(() => projectExportPath(config, "../outside")).toThrow(ProjectExportValidationError);
  });
});

import type { ToolDescriptor } from "../../types.js";

export interface RipgrepOptions {
  pattern: string;
  paths: string[];
  glob?: string[];
  signal?: AbortSignal;
}

export interface RipgrepMatch {
  path: string;
  line: number;
  text: string;
}

export interface RipgrepResult {
  matches: RipgrepMatch[];
  truncated: boolean;
}

export type RipgrepTool = ToolDescriptor<RipgrepOptions, RipgrepResult>;

/** Supplied descriptor shape; invocation needs the D1 worker binding. */
export function defineRipgrepTool(partial: Partial<RipgrepTool> & { name: "ripgrep" }): RipgrepTool {
  return {
    version: partial.version ?? "0.0.0-a0",
    invoke: partial.invoke ?? (() => Promise.reject(new Error("ripgrep has no backend in workspace-api A0 (see MAPPING.md)"))),
    ...partial,
    name: "ripgrep",
  } as RipgrepTool;
}

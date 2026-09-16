import { expect, test } from "bun:test";
import { errorMessage } from "./error-details.js";

test("WASM errors retain object fields, numeric codes, and nested causes", () => {
  expect(errorMessage({ code: -2, message: "Unsupported file" })).toContain('"code":-2');
  expect(errorMessage({ code: -2, message: "Unsupported file" })).toContain("Unsupported file");
  expect(errorMessage(-100007)).toBe("-100007");
  expect(errorMessage(new Error("Decode failed", { cause: { code: -2 } }))).toContain('"code":-2');
  const circular: { self?: unknown } = {};
  circular.self = circular;
  expect(errorMessage(circular)).toContain("[Circular]");
});

import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("fixture dependencies render escaped content correctly", () => {
  assert.equal(renderToStaticMarkup(React.createElement("h1", null, "Edit <script> & preview")),
    "<h1>Edit &lt;script&gt; &amp; preview</h1>");
});
test("fixture source and asset are readable in the runtime workspace", () => {
  assert.match(readFileSync("src/WelcomeCard.tsx", "utf8"), /<h1>.+<\/h1>/);
  assert.match(readFileSync("src/mark.svg", "utf8"), /<svg/);
});

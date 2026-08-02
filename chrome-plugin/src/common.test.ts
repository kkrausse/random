import test from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, messageFromJson, xmlEscape } from "./common";

test("buildPrompt fills and escapes structured source fields", () => {
  const prompt = buildPrompt("<reading_request>{{highlight}}|{{page_url}}|{{question}}</reading_request>", {
    highlight: "a <tag> & more",
    pageUrl: "https://example.com/?a=1&b=2"
  }, "explain > this");
  assert.equal(prompt, "<reading_request>a &lt;tag&gt; &amp; more|https://example.com/?a=1&amp;b=2|explain &gt; this</reading_request>");
});

test("buildPrompt leaves plain templates unescaped", () => {
  assert.equal(buildPrompt("{{highlight}}: {{question}}", { highlight: "A & B" }, "why?"),
    "A & B: why?");
});

test("messageFromJson joins assistant text parts", () => {
  assert.deepEqual(messageFromJson({
    id: "message-1",
    type: "assistant",
    content: [{ type: "text", text: "Hello " }, { type: "tool" }, { type: "text", text: "world" }],
    time: { completed: 1 }
  }), { id: "message-1", role: "OpenCode", text: "Hello world", complete: true });
});

test("xmlEscape escapes boundary-changing characters", () => {
  assert.equal(xmlEscape("</source> & text"), "&lt;/source&gt; &amp; text");
});

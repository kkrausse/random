import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHighlightPrompt,
  buildPrompt,
  messageFromJson,
  readingPromptFromText,
  xmlEscape
} from "./common";

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
    model: { providerID: "openai", id: "gpt-5", variant: "high" },
    time: { completed: 1 }
  }), {
    id: "message-1",
    role: "OpenCode",
    text: "Hello world",
    complete: true,
    model: { providerID: "openai", id: "gpt-5", variant: "high" }
  });
});

test("xmlEscape escapes boundary-changing characters", () => {
  assert.equal(xmlEscape("</source> & text"), "&lt;/source&gt; &amp; text");
});

test("readingPromptFromText extracts display fields and decodes source text", () => {
  assert.deepEqual(readingPromptFromText(`<reading_request><source_material>
    <page_title>A &amp; B</page_title><page_url>https://example.com/?a=1&amp;b=2</page_url>
    <surrounding_context>Before &lt; after</surrounding_context>
    <highlighted_passage>The passage</highlighted_passage></source_material>
    <instructions><reader_question>Why?</reader_question></instructions></reading_request>`), {
    question: "Why?",
    highlight: "The passage",
    surroundingContext: "Before < after",
    pageTitle: "A & B",
    pageUrl: "https://example.com/?a=1&b=2"
  });
});

test("readingPromptFromText ignores follow-up messages", () => {
  assert.equal(readingPromptFromText("Can you expand on that?"), null);
});

test("buildHighlightPrompt includes only the new highlight and question", () => {
  const prompt = buildHighlightPrompt("A < B", "Why & how?");
  assert.deepEqual(readingPromptFromText(prompt), {
    question: "Why & how?",
    highlight: "A < B",
    surroundingContext: "",
    pageTitle: "",
    pageUrl: ""
  });
  assert.doesNotMatch(prompt, /surrounding_context|page_title|page_url/);
});

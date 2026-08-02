export interface PromptPreset {
  label: string;
  prompt: string;
}

export interface Settings {
  serverUrl: string;
  directory: string;
  serverPassword: string;
  modelProvider: string;
  modelId: string;
  modelVariant: string;
  messageTemplate: string;
  promptPresets: PromptPreset[];
}

export interface Capture {
  highlight: string;
  surroundingContext: string;
  pageTitle: string;
  pageUrl: string;
  capturedAt: number;
}

export interface Model {
  name: string;
  providerId: string;
  modelId: string;
  variants: string[];
}

export interface Message {
  id: string;
  role: "You" | "OpenCode";
  text: string;
  complete: boolean;
}

export interface ReadingPrompt {
  question: string;
  highlight: string;
  surroundingContext: string;
  pageTitle: string;
  pageUrl: string;
}

interface ApiModel {
  name?: string;
  modelID: string;
  providerID: string;
  enabled?: boolean;
  status?: string;
  variants?: Array<{ id?: string }>;
}

interface ApiMessage {
  id: string;
  type: string;
  text?: string;
  content?: Array<{ type: string; text?: string }>;
  time?: { completed?: number };
}

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: "http://raspberrypi.example.ts.net:41137",
  directory: "/home/pi/deploys/palma2-opencode/workdir",
  serverPassword: "",
  modelProvider: "opencode",
  modelId: "laguna-s-2.1-free",
  modelVariant: "medium",
  messageTemplate: `<reading_request>
  <source_material>
    <page_title>{{page_title}}</page_title>
    <page_url>{{page_url}}</page_url>
    <surrounding_context>
{{surrounding_context}}
    </surrounding_context>
    <highlighted_passage>
{{highlight}}
    </highlighted_passage>
  </source_material>
  <instructions>
    <reader_question>
{{question}}
    </reader_question>
  </instructions>
</reading_request>`,
  promptPresets: [
    {
      label: "Explain terms",
      prompt: "Identify up to five terms, names, allusions, or references in the highlighted passage that a reader may not recognize. Give a brief explanation of each in this context. Do not list ordinary words merely to fill space."
    },
    {
      label: "Why it matters",
      prompt: "Explain what role the highlighted passage plays in the author's broader point or the surrounding discussion. Base the answer only on the supplied text and distinguish inference from explicit evidence."
    },
    {
      label: "Background context",
      prompt: "Give the minimum historical, cultural, scientific, or philosophical context needed to understand the highlighted passage. Research external facts when useful and distinguish them from the page's claims."
    }
  ]
};

export function xmlEscape(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function buildPrompt(template: string, capture: Partial<Capture> | null, question: string): string {
  const values = {
    highlight: capture?.highlight || "None captured",
    surrounding_context: capture?.surroundingContext || "None captured",
    page_title: capture?.pageTitle || "Unknown page",
    page_url: capture?.pageUrl || "Unknown URL",
    question
  };
  const xml = template.includes("<reading_request>");
  return template.replace(/\{\{(highlight|surrounding_context|page_title|page_url|question)\}\}/g,
    (_, key: keyof typeof values) => xml ? xmlEscape(values[key]) : values[key]);
}

export function buildHighlightPrompt(highlight: string, question: string): string {
  return `<reading_request>
  <source_material>
    <highlighted_passage>
${xmlEscape(highlight)}
    </highlighted_passage>
  </source_material>
  <instructions>
    <reader_question>
${xmlEscape(question)}
    </reader_question>
  </instructions>
</reading_request>`;
}

function xmlUnescape(value: string): string {
  return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"").replaceAll("&apos;", "'").replaceAll("&amp;", "&");
}

function elementText(prompt: string, tag: string): string {
  const match = prompt.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? xmlUnescape(match[1]).trim() : "";
}

export function readingPromptFromText(prompt: string): ReadingPrompt | null {
  if (!/<reading_request(?:\s[^>]*)?>/i.test(prompt)) return null;
  const result = {
    question: elementText(prompt, "reader_question"),
    highlight: elementText(prompt, "highlighted_passage"),
    surroundingContext: elementText(prompt, "surrounding_context"),
    pageTitle: elementText(prompt, "page_title"),
    pageUrl: elementText(prompt, "page_url")
  };
  return result.question || result.highlight || result.surroundingContext ? result : null;
}

export function modelFromJson(value: ApiModel): Model {
  return {
    name: value.name || value.modelID,
    providerId: value.providerID,
    modelId: value.modelID,
    variants: (value.variants || []).map((variant) => variant.id).filter(Boolean)
  };
}

export function messageFromJson(value: ApiMessage): Message | null {
  if (value.type === "user") {
    return { id: value.id, role: "You", text: value.text || "", complete: true };
  }
  if (value.type !== "assistant") return null;
  const text = (value.content || [])
    .filter((part) => part.type === "text")
    .map((part) => part.text || "").join("");
  const complete = Boolean(value.time?.completed);
  return text || !complete
    ? { id: value.id, role: "OpenCode", text, complete }
    : null;
}

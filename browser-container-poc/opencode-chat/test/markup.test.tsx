import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, safeHref } from "../src/markdown";
test("Markdown never executes HTML or unsafe links, and supports incomplete fences", () => {
  const html = renderToStaticMarkup(
    <Markdown
      text={
        '<img src=x onerror=alert(1)>\n\n[bad](javascript:alert%281%29)\n\n```js\nconst x = "<script>"'
      }
    />,
  );
  expect(html).not.toContain("<img");
  expect(html).not.toContain('href="javascript');
  expect(html).toContain("&lt;img");
  expect(html).toContain("const x");
  expect(html).toContain("Copy");
  for (const href of [
    "javascript:alert(1)",
    "data:text/html,x",
    "//evil.test",
    "java\nscript:alert(1)",
  ])
    expect(safeHref(href)).toBeUndefined();
  expect(safeHref("https://example.com")).toBe("https://example.com");
});

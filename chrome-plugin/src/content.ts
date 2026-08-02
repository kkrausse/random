(() => {
  const MAX_CONTEXT_WORDS = 5000;
  const CAPTURE_DELAY_MS = 100;
  let captureTimer: ReturnType<typeof setTimeout> | null = null;

  function readableRoot(element: Element | null) {
    return element?.closest("article, main, [role='main']")
      || document.querySelector("article, main, [role='main']")
      || document.body;
  }

  function contextAroundHighlight(text: string, highlight: string) {
    const clean = text.replace(/\s+/g, " ").trim();
    const words = clean.match(/\S+/g) || [];
    if (words.length <= MAX_CONTEXT_WORDS) {
      return clean;
    }

    const index = clean.indexOf(highlight.replace(/\s+/g, " ").trim());
    const prefixWords = index < 0 ? Math.floor(words.length / 2)
      : (clean.slice(0, index).match(/\S+/g) || []).length;
    const highlightWords = (highlight.match(/\S+/g) || []).length;
    const start = Math.max(0, Math.min(
      prefixWords - Math.floor((MAX_CONTEXT_WORDS - highlightWords) / 2),
      words.length - MAX_CONTEXT_WORDS
    ));
    return `${start > 0 ? "[Earlier page context omitted.]\n\n" : ""}`
      + words.slice(start, start + MAX_CONTEXT_WORDS).join(" ")
      + (start + MAX_CONTEXT_WORDS < words.length ? "\n\n[Later page context omitted.]" : "");
  }

  async function captureSelection() {
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const highlight = selection.toString().trim();
    if (!highlight) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const element = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer as Element
      : range.commonAncestorContainer.parentElement;
    const pageText = (readableRoot(element) as HTMLElement | null)?.innerText
      || document.body.innerText || "";

    try {
      await chrome.runtime.sendMessage({
        type: "update-reading-context",
        capture: {
          highlight,
          surroundingContext: contextAroundHighlight(pageText, highlight),
          pageTitle: document.title,
          pageUrl: location.href,
          capturedAt: Date.now()
        }
      });
    } catch (error) {
      console.warn("Reading Context could not capture the selection:", error);
    }
  }

  document.addEventListener("selectionchange", () => {
    if (captureTimer !== null) clearTimeout(captureTimer);
    captureTimer = setTimeout(() => {
      captureTimer = null;
      void captureSelection();
    }, CAPTURE_DELAY_MS);
  });
})();

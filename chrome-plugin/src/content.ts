(() => {
  const BUTTON_ID = "reading-context-explain-button";
  const NOTICE_ID = "reading-context-open-notice";
  const MAX_CONTEXT_WORDS = 5000;
  let savedSelection: { highlight: string; range: Range } | null = null;

  function removeButton() {
    document.getElementById(BUTTON_ID)?.remove();
  }

  function showOpenFallback() {
    document.getElementById(NOTICE_ID)?.remove();
    const notice = document.createElement("div");
    notice.id = NOTICE_ID;
    notice.textContent = "Chrome blocked automatic opening. Click the Reading Context toolbar icon.";
    notice.addEventListener("click", () => notice.remove());
    document.documentElement.appendChild(notice);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "reading-context-panel-open-error") showOpenFallback();
  });

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

  function showButton(selection: Selection | null) {
    removeButton();
    if (!selection || selection.rangeCount === 0) {
      return;
    }
    const highlight = selection.toString().trim();
    if (!highlight) return;

    const range = selection.getRangeAt(0).cloneRange();
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      return;
    }
    savedSelection = { highlight, range };

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "Explain";
    button.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - 100))}px`;
    button.style.top = `${Math.max(8, Math.min(rect.bottom + 8, innerHeight - 44))}px`;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", async () => {
      const selected = savedSelection;
      if (!selected) return;
      const element = selected.range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? selected.range.commonAncestorContainer as Element
        : selected.range.commonAncestorContainer.parentElement;
      const pageText = (readableRoot(element) as HTMLElement | null)?.innerText
        || document.body.innerText || "";
      const capture = {
        highlight: selected.highlight,
        surroundingContext: contextAroundHighlight(pageText, selected.highlight),
        pageTitle: document.title,
        pageUrl: location.href,
        capturedAt: Date.now()
      };
      removeButton();
      try {
        await chrome.runtime.sendMessage({
          type: "open-reading-context",
          capture
        });
      } catch (error) {
        console.warn("Reading Context could not request the side panel:", error);
      }
    });
    document.documentElement.appendChild(button);
  }

  document.addEventListener("mouseup", () => {
    setTimeout(() => showButton(getSelection()), 0);
  });
  document.addEventListener("keyup", (event) => {
    if (event.key.startsWith("Arrow") || event.key === "Shift") {
      showButton(getSelection());
    }
  });
  document.addEventListener("mousedown", (event) => {
    if ((event.target as Element | null)?.id !== BUTTON_ID) removeButton();
  });
  addEventListener("scroll", removeButton, true);
})();

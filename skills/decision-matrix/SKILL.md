---
name: Decision Matrix
description: Rich Hickey decision matrices for comparing approaches and tradeoffs.
---

# Decision matrices

Use the approach Rich Hickey describes in [Design in Practice (2023)](https://youtu.be/c5QF2HjHLSE?t=2348). The [transcript](https://github.com/matthiasn/talk-transcripts/blob/master/Hickey_Rich/DesignInPractice.md) covers the matrix from ~39:08 to ~53:18; [slides](https://download.clojure.org/presentations/DesignInPractice.pdf). The matrix is a shared thinking tool for *creating* a better approach, not a weighted-score shopping exercise.

## Work through the decision

1. State the **problem and specific decision** succinctly at the top (A1 in a spreadsheet). If given a requested feature or favorite solution, first identify the underlying objective and obstacle. If essential context is missing, ask a focused question; otherwise state assumptions and start a draft.
2. Put **approaches in columns**. Include the status quo/do-nothing option for an existing system, relevant approaches others use, and multiple plausible initial ideas. Give each a meaningful, distinguishing title and a short explanation if needed. Don't assume the eventual answer is already among them.
3. Put **criteria in rows**. Derive them from the problem, use cases, constraints, and what actually distinguishes these approaches. Consider problem fit, complexity, compatibility, effort/cost, operational burden, and risks *only when relevant*. Put the most important and most distinguishing rows first; don't copy an exhaustive generic checklist.
4. In each cell write a **specific, concise description of how** that approach handles the criterion, or what is not yet known. Avoid bare yes/no, numeric ranks, or unsupported claims. Keep descriptive facts separate from subjective assessment. Make uncertainties visible with `?` and say what evidence would resolve them.
5. If useful, mark assessments separately: neutral/clear, yellow/concern, red/blocker, green/distinctive strength. In text-only output, use words or symbols **with a legend**, not color alone. Don't compute a weighted total by default; a blocker or a valuable tradeoff is not well represented by a summed score.
6. Compare **across each row**, not just down each column. Look for missing criteria when two options look identical, and question an implausibly all-green option. Use the contrasts to propose new or hybrid approaches, update the matrix, and record the benefits, tradeoffs, unresolved questions, and provisional direction (if warranted).

## Output and collaboration

- For a quick request, use a readable Markdown table followed by a brief synthesis and next questions. For an ongoing team decision, offer a live-editable spreadsheet or spreadsheet-ready table; don't create an external document unless asked or appropriate to the user's workspace.
- Keep the decision statement, criteria, and relevant details in view. Don't hide the essential comparison behind links, comments, or generic pros/cons blobs. Links can supplement a cell's summary.
- Distinguish evidence from assumptions and preferences. If information is insufficient to pick a winner, say so and identify the smallest useful investigation rather than manufacturing certainty.
- A matrix can compare high-level directions or lower-level implementation tactics; be explicit which decision is being made.

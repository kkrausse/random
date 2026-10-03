import * as mupdf from "mupdf"
import { mkdir } from "node:fs/promises"
import { basename, extname, join, resolve } from "node:path"

type BBox = { x: number; y: number; w: number; h: number }
type TextLine = {
  bbox: BBox
  font: {
    family: "serif" | "sans-serif" | "monospace"
    weight: "normal" | "bold"
    style: "normal" | "italic"
    size: number
  }
  text: string
  href?: string
  paragraphBreakBefore?: boolean
}
type TextBlock = { type: "text"; bbox: BBox; lines: TextLine[] }
type ImageBlock = { type: "image"; bbox: BBox; src: string; width: number; height: number }
type StructuredPage = { blocks: Array<TextBlock | { type: string; bbox?: BBox }> }
type PageData = { number: number; width: number; height: number; blocks: Array<TextBlock | ImageBlock>; sourcePage: string; notices: string[] }
type PageLink = { bbox: BBox; href: string }

const args = Bun.argv.slice(2)
if (!args[0] || args.includes("--help") || args.includes("-h")) {
  console.log("Usage: bun pdf:web <input.pdf> [output-directory] [--dpi 144] [--title title] [--full-pages]\nFull-page images are opt-in with --full-pages.")
  process.exit(args[0] ? 0 : 1)
}

const inputPath = resolve(args[0])
const dpiFlag = args.indexOf("--dpi")
if (dpiFlag >= 0 && !args[dpiFlag + 1]) throw new Error("--dpi requires a value")
const titleFlag = args.indexOf("--title")
if (titleFlag >= 0 && !args[titleFlag + 1]) throw new Error("--title requires a value")
const dpi = dpiFlag >= 0 ? Number(args[dpiFlag + 1]) : 144
const includeFullPages = args.includes("--full-pages")
if (!Number.isFinite(dpi) || dpi < 72 || dpi > 300) {
  throw new Error("--dpi must be a number from 72 through 300")
}

const positional = args.filter((arg, index) =>
  arg !== "--full-pages" &&
  (dpiFlag < 0 || (index !== dpiFlag && index !== dpiFlag + 1)) &&
  (titleFlag < 0 || (index !== titleFlag && index !== titleFlag + 1)),
)
const documentName = titleFlag >= 0 ? args[titleFlag + 1] : basename(inputPath, extname(inputPath))
const outputPath = resolve(positional[1] ?? join(import.meta.dir, "output", documentName))
const assetsPath = join(outputPath, "assets")

await Bun.file(inputPath).exists().then((exists) => {
  if (!exists) throw new Error(`PDF not found: ${inputPath}`)
})
await mkdir(assetsPath, { recursive: true })
await Bun.write(join(outputPath, "original.pdf"), Bun.file(inputPath))

const document = mupdf.Document.openDocument(await Bun.file(inputPath).bytes(), "application/pdf")
const pages: PageData[] = []
const imageCache = new Map<string, { src: string; width: number; height: number }>()

try {
  for (let index = 0; index < document.countPages(); index++) {
    const page = document.loadPage(index)
    try {
      const [x0, y0, x1, y1] = page.getBounds()
      const links = page.getLinks()
      const pageLinks: PageLink[] = links.map((link) => ({
        bbox: toBBox(link.getBounds()),
        href: link.isExternal() ? link.getURI() : `#page-${document.resolveLink(link) + 1}`,
      }))
      links.forEach((link) => link.destroy())
      const structuredText = page.toStructuredText("preserve-spans,preserve-whitespace,preserve-images")
      let data: StructuredPage
      const notices: string[] = []
      let vectorOperations = 0
      let paintedImages = 0
      let complexImages = false
      const audit = new mupdf.Device({
        fillPath() { vectorOperations++ },
        strokePath() { vectorOperations++ },
        fillShade() { vectorOperations++ },
        fillImage() { paintedImages++ },
        fillImageMask() { complexImages = true },
        clipImageMask() { complexImages = true },
      })
      try { page.run(audit, mupdf.Matrix.identity); audit.close() } finally { audit.destroy() }
      try {
        data = JSON.parse(structuredText.asJSON()) as StructuredPage
      } finally {
        structuredText.destroy()
      }
      const textLines = data.blocks.filter(block => block.type === "text").flatMap(block => (block as TextBlock).lines)
      const totalText = textLines.reduce((sum, line) => sum + line.text.trim().length, 0)
      // A page-sized backdrop behind prose would turn the article back into a page screenshot.
      const backgrounds = new Set(data.blocks.filter(block => {
        if (block.type !== "image" || !block.bbox || totalText < 500) return false
        const area = block.bbox.w * block.bbox.h / ((x1 - x0) * (y1 - y0))
        const coveredText = textLines.filter(line => contains(block.bbox!, line.bbox)).reduce((sum, line) => sum + line.text.trim().length, 0)
        return area > 0.7 && coveredText / totalText > 0.8
      }))
      if (backgrounds.size) notices.push("Page-sized background images behind the text were omitted to keep this page as readable HTML.")
      // Wide, shallow images at the very top are recurring document chrome in
      // reports such as Tree Rings, not figures that belong in reflowed prose.
      const marginBanners = new Set(data.blocks.filter(block => block.type === "image" && block.bbox &&
        block.bbox.y < (y1 - y0) * 0.1 && block.bbox.w > (x1 - x0) * 0.75 && block.bbox.h < (y1 - y0) * 0.1))
      const imageBounds = data.blocks.filter(block => block.type === "image" && block.bbox && !backgrounds.has(block) && !marginBanners.has(block)).map(block => block.bbox!)
      // Render the complete composited page once, then keep only the image regions.
      // This includes vector/text overlays, clipping, masks, and PDF annotations.
      const scale = dpi / 72
      let rendered: mupdf.Pixmap | undefined
      if (imageBounds.length || includeFullPages) {
        rendered = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true)
      }
      const blocks: Array<TextBlock | ImageBlock> = []
      let figureNumber = 0
      try {
        for (const block of data.blocks) {
          if (block.type === "text") {
            const textBlock = block as TextBlock
            // Annotation labels inside a figure are already present in its rendered crop.
            textBlock.lines = textBlock.lines.filter(line => !imageBounds.some(bounds => contains(bounds, line.bbox)))
            if (!textBlock.lines.length) continue
            for (const line of textBlock.lines) {
              line.href = pageLinks.find((link) => overlaps(line.bbox, link.bbox))?.href
            }
            blocks.push(textBlock)
            continue
          }
          if (block.type !== "image" || !block.bbox) continue
          if (backgrounds.has(block) || marginBanners.has(block)) continue
          if (!rendered) continue
          figureNumber++
          const left = Math.max(0, Math.floor(block.bbox.x * scale) - rendered.getX())
          const top = Math.max(0, Math.floor(block.bbox.y * scale) - rendered.getY())
          const right = Math.min(rendered.getWidth(), Math.ceil((block.bbox.x + block.bbox.w) * scale) - rendered.getX())
          const bottom = Math.min(rendered.getHeight(), Math.ceil((block.bbox.y + block.bbox.h) * scale) - rendered.getY())
          if (right <= left || bottom <= top) {
            notices.push("An image region lies outside the visible page and could not be rendered.")
            continue
          }
          const width = right - left, height = bottom - top
          const crop = cropPixmap(rendered, left, top, width, height)
          let png: Uint8Array
          try { png = Uint8Array.from(crop.asPNG()) } finally { crop.destroy() }
          const hash = new Bun.CryptoHasher("sha256").update(png).digest("hex")
          let encoded = imageCache.get(hash)
          if (!encoded) {
            const src = `assets/page-${String(index + 1).padStart(3, "0")}-figure-${figureNumber}-${hash.slice(0, 12)}.png`
            await Bun.write(join(outputPath, src), png)
            encoded = { src, width, height }
            imageCache.set(hash, encoded)
          }
          blocks.push({ type: "image", bbox: block.bbox, ...encoded })
        }
        if (includeFullPages && rendered) {
          await Bun.write(join(assetsPath, `page-${String(index + 1).padStart(3, "0")}.jpg`), rendered.asJPEG(90))
        }
      } finally {
        rendered?.destroy()
      }
      if (vectorOperations) notices.push("Vector drawings inside image boundaries are preserved in the figures. Drawings outside those boundaries (including standalone charts or decoration) may be absent from this view.")
      if (complexImages || paintedImages !== blocks.filter(block => block.type === "image").length + backgrounds.size) notices.push("Image layers and masks inside figure crops are preserved; additional image content outside those regions may be absent.")
      if (!totalText) notices.push("No selectable text was found. OCR is needed for searchable, reflowed text.")
      blocks.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)

      pages.push({
        number: index + 1,
        width: x1 - x0,
        height: y1 - y0,
        blocks,
        sourcePage: `assets/page-${String(index + 1).padStart(3, "0")}.jpg`,
        notices,
      })

      console.log(`Processed page ${index + 1}/${document.countPages()}`)
      for (const notice of notices) console.warn(`Page ${index + 1}: ${notice}`)
    } finally {
      page.destroy()
    }
  }
} finally {
  document.destroy()
}

const bodySize = findBodyFontSize(pages)
const repeatedMargins = findRepeatedMargins(pages)
const article = pages.map((page) => renderPage(page, bodySize, repeatedMargins)).join("\n")
await Bun.write(join(outputPath, "index.html"), renderDocument(documentName, article, pages.length))
await Bun.write(join(outputPath, "conversion-report.json"), JSON.stringify({
  pages: pages.map(page => ({ page: page.number, images: page.blocks.filter(block => block.type === "image").length, notices: page.notices })),
  originalPdf: "original.pdf",
  figureRendering: "composited-page-crops",
  dpi,
}, null, 2))

console.log(`Created ${join(outputPath, "index.html")}`)

function findBodyFontSize(allPages: PageData[]) {
  const histogram = new Map<number, number>()
  for (const page of allPages) {
    for (const block of page.blocks) {
      if (block.type !== "text") continue
      for (const line of block.lines) {
        const size = Math.round(line.font.size * 2) / 2
        histogram.set(size, (histogram.get(size) ?? 0) + line.text.trim().length)
      }
    }
  }
  return [...histogram].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 11
}

function findRepeatedMargins(allPages: PageData[]) {
  const occurrences = new Map<string, Set<number>>()
  for (const page of allPages) {
    for (const block of page.blocks) {
      if (block.type !== "text") continue
      const inMargin = block.bbox.y < page.height * 0.1 || block.bbox.y + block.bbox.h > page.height * 0.9
      const key = normalize(block.lines.map((line) => line.text).join(" "))
      if (!inMargin || !key || key.length > 160) continue
      const pagesForText = occurrences.get(key) ?? new Set<number>()
      pagesForText.add(page.number)
      occurrences.set(key, pagesForText)
    }
  }
  const threshold = Math.max(2, Math.ceil(allPages.length * 0.4))
  return new Set([...occurrences].filter(([, pageNumbers]) => pageNumbers.size >= threshold).map(([text]) => text))
}

function renderPage(page: PageData, bodySize: number, repeatedMargins: Set<string>) {
  const blocks = page.blocks
    .filter((block) => block.type === "image" || !repeatedMargins.has(normalize(block.lines.map((line) => line.text).join(" "))))
    .map((block) => block.type === "image" ? renderImage(block, page.number) : renderBlock(block, bodySize))
    .filter(Boolean)
    .join("\n")
  const sourcePage = includeFullPages ? `<details class="source-page">
    <summary>Original page ${page.number}</summary>
    <p><a href="original.pdf#page=${page.number}">Open this page in the original PDF</a> for full-resolution text and graphics.</p>
    <a href="${page.sourcePage}" target="_blank" rel="noopener"><img src="${page.sourcePage}" width="${Math.round(page.width * dpi / 72)}" height="${Math.round(page.height * dpi / 72)}" alt="Original PDF page ${page.number}" loading="lazy"></a>
  </details>` : ""

  return `<section class="document-page" id="page-${page.number}">
  <div class="page-marker">Page ${page.number}</div>
  ${page.notices.map(notice => `<aside class="conversion-notice">${escapeHtml(notice)} <a href="original.pdf#page=${page.number}" target="_blank" rel="noopener">Check page ${page.number} in the original PDF.</a></aside>`).join("\n")}
  <div class="reflowed">${blocks || '<p class="empty-page">No selectable text was found on this page.</p>'}</div>
${sourcePage}
</section>`
}

function renderImage(block: ImageBlock, pageNumber: number) {
  return `<figure><a href="${block.src}" target="_blank" rel="noopener"><img src="${block.src}" width="${block.width}" height="${block.height}" alt="Figure from PDF page ${pageNumber}" loading="lazy"></a></figure>`
}

function toBBox([x, y, right, bottom]: mupdf.Rect): BBox {
  return { x, y, w: right - x, h: bottom - y }
}

function cropPixmap(source: mupdf.Pixmap, left: number, top: number, width: number, height: number) {
  const crop = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], false)
  const sourcePixels = source.getPixels()
  const cropPixels = crop.getPixels()
  const components = source.getNumberOfComponents()
  for (let y = 0; y < height; y++) {
    const sourceStart = (top + y) * source.getStride() + left * components
    cropPixels.set(sourcePixels.subarray(sourceStart, sourceStart + width * components), y * crop.getStride())
  }
  return crop
}

function contains(outer: BBox, inner: BBox) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
}

function overlaps(a: BBox, b: BBox) {
  const centerX = a.x + a.w / 2
  const centerY = a.y + a.h / 2
  return centerX >= b.x - 2 && centerX <= b.x + b.w + 2 && centerY >= b.y - 2 && centerY <= b.y + b.h + 2
}

function renderBlock(block: TextBlock, bodySize: number) {
  const lines: TextLine[] = []
  let paragraphBreakBefore = false
  for (const line of block.lines) {
    const text = line.text.replace(/\s+/g, " ")
    if (!text.trim()) {
      paragraphBreakBefore = lines.length > 0
      continue
    }
    lines.push({ ...line, text, paragraphBreakBefore })
    paragraphBreakBefore = false
  }
  if (!lines.length) return ""
  const text = clean(joinLines(lines).map((line) => line.text).join(""))
  if (text === "\\") return ""

  const visualLines = groupVisualLines(lines)
  const numberedItems: TextLine[][] = []
  const firstNumber = plainText(visualLines[0]).match(/^(\d+)[.)]\s+\S/)
  const start = firstNumber ? Number(firstNumber[1]) : 0
  const listX = visualLines[0][0].bbox.x
  for (const visualLine of visualLines) {
    const marker = plainText(visualLine).match(/^(\d+)[.)]\s+\S/)
    if (firstNumber && marker && Number(marker[1]) === start + numberedItems.length && Math.abs(visualLine[0].bbox.x - listX) < 12) numberedItems.push([])
    numberedItems.at(-1)?.push(...visualLine)
  }
  if (numberedItems.length > 1) {
    return `<ol start="${start}">${numberedItems.map((item) => {
      const [first, ...rest] = item
      return `<li>${renderText([{ ...first, text: first.text.replace(/^\d+[.)]\s*/, "") }, ...rest])}</li>`
    }).join("")}</ol>`
  }

  const content = renderText(lines)
  const largestSize = Math.max(...lines.map((line) => line.font.size))
  const mostlyBold = lines.filter((line) => line.font.weight === "bold").length >= lines.length / 2
  const heading = text.length < 180 && (largestSize >= bodySize * 1.15 || (mostlyBold && text.length < 100))

  if (heading) {
    const level = largestSize >= bodySize * 1.75 ? 2 : largestSize >= bodySize * 1.35 ? 3 : 4
    return `<h${level}>${content}</h${level}>`
  }

  if (/^[•▪◦‣]\s*/.test(plainText(visualLines[0]))) {
    const [first, ...rest] = lines
    return `<ul><li>${renderText([{ ...first, text: first.text.replace(/^[•▪◦‣]\s*/, "") }, ...rest])}</li></ul>`
  }

  const font = lines[0].font
  const classes = [font.family === "monospace" && "monospace", font.style === "italic" && "italic"]
    .filter(Boolean)
    .join(" ")
  const shortStack = lines.some(line => line.href?.startsWith("mailto:")) && visualLines.length >= 4 && visualLines.every((line) => plainText(line).length < 50)
  if (shortStack) {
    return `<p${classes ? ` class="${classes}"` : ""}>${visualLines.map((line) => renderText(line)).join("<br>")}</p>`
  }
  return `<p${classes ? ` class="${classes}"` : ""}>${content}</p>`
}

function groupVisualLines(lines: TextLine[]) {
  const groups: TextLine[][] = []
  for (const line of lines) {
    const group = groups.at(-1)
    const previous = group?.at(-1)
    if (!previous || Math.abs(line.bbox.y - previous.bbox.y) >= Math.max(line.bbox.h, previous.bbox.h) * 0.5) groups.push([])
    groups.at(-1)!.push(line)
  }
  return groups
}

function plainText(lines: TextLine[]) {
  return clean(joinLines(lines).map((line) => line.text).join(""))
}

function renderText(lines: TextLine[]) {
  const parts = joinLines(lines)
  let result = ""
  let activeStyle = ""
  for (const part of parts) {
    if (!part.text) continue
    const style = `${part.href ?? ""}\0${part.font.weight}\0${part.font.style}`
    if (style !== activeStyle) {
      if (activeStyle) result += closeInline(activeStyle)
      if (part.breakBefore) result += part.paragraphBreakBefore ? "<br><br>" : "<br>"
      if (part.href) {
        result += `<a href="${escapeHtml(part.href)}"${/^https?:/i.test(part.href) ? ' target="_blank" rel="noopener"' : ""}>`
      }
      if (part.font.weight === "bold") result += "<strong>"
      if (part.font.style === "italic") result += "<em>"
      activeStyle = style
    } else if (part.breakBefore) result += part.paragraphBreakBefore ? "<br><br>" : "<br>"
    result += escapeHtml(part.text)
  }
  if (activeStyle) result += closeInline(activeStyle)
  // Only link plain text outside existing anchors; never rewrite attributes.
  let inAnchor = false
  return result.trim().replace(/\s+/g, " ").split(/(<[^>]+>)/).map(part => {
    if (part.startsWith("<")) {
      if (/^<a\s/.test(part)) inAnchor = true
      if (part === "</a>") inAnchor = false
      return part
    }
    return inAnchor ? part : part.replace(/\(Page\s+(\d+)\)/gi, (match, number) =>
      Number(number) >= 1 && Number(number) <= pages.length ? `<a href="#page-${number}">${match}</a>` : match,
    )
  }).join("")
}

function closeInline(style: string) {
  const [href, weight, fontStyle] = style.split("\0")
  return `${fontStyle === "italic" ? "</em>" : ""}${weight === "bold" ? "</strong>" : ""}${href ? "</a>" : ""}`
}

function joinLines(lines: TextLine[]) {
  const result: Array<Pick<TextLine, "text" | "href" | "font" | "paragraphBreakBefore"> & { breakBefore?: boolean }> = []
  let previous: TextLine | undefined
  for (const line of lines) {
    let text = line.text
    let sameVisualLine = false
    if (previous) {
      sameVisualLine = Math.abs(line.bbox.y - previous.bbox.y) < Math.max(line.bbox.h, previous.bbox.h) * 0.5
      const previousPart = result.at(-1)!
      if (sameVisualLine) {
        const gap = line.bbox.x - (previous.bbox.x + previous.bbox.w)
        if (gap > 1 && !/\s$/.test(previousPart.text) && !/^\s/.test(text)) text = ` ${text}`
      } else {
        const dehyphenate = /-$/.test(previousPart.text.trimEnd()) && /^\s*[a-z]/.test(text)
        if (dehyphenate) previousPart.text = previousPart.text.trimEnd().slice(0, -1)
        else if (!/\s$/.test(previousPart.text) && !/^\s/.test(text)) text = ` ${text}`
      }
    }
    const paragraphBreakBefore = Boolean(line.paragraphBreakBefore || (previous && !sameVisualLine && line.bbox.y - (previous.bbox.y + previous.bbox.h) > Math.max(line.bbox.h, previous.bbox.h) * 0.65))
    const breakBefore = Boolean(previous && !sameVisualLine && paragraphBreakBefore)
    result.push({ text, href: line.href, font: line.font, breakBefore, paragraphBreakBefore })
    previous = line
  }
  return result
}

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function normalize(value: string) {
  return clean(value).toLocaleLowerCase().replace(/\d+/g, "#")
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!)
}

function renderDocument(title: string, content: string, pageCount: number) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; color: #222; background: white; font: 16px/1.55 system-ui, sans-serif; overflow-wrap: anywhere; }
    header, main { width: min(100% - 32px, 720px); margin: 0 auto; }
    header { padding: 24px 0 16px; border-bottom: 1px solid #ddd; }
    header span { margin-left: 8px; color: #666; font-size: 14px; }
    main { padding: 24px 0 64px; }
    .document-page + .document-page { margin-top: 48px; padding-top: 24px; border-top: 1px solid #ddd; }
    .page-marker { margin-bottom: 16px; color: #666; font-size: 13px; }
    h2, h3, h4 { margin: 1.5em 0 .5em; line-height: 1.25; }
    h2 { font-size: 1.75rem; }
    h3 { font-size: 1.4rem; }
    h4 { font-size: 1.1rem; }
    p { margin: 0 0 1em; }
    a { color: #075ea8; text-decoration-thickness: .08em; text-underline-offset: .12em; }
    a:hover { color: #003f73; }
    ul, ol { padding-left: 24px; }
    li + li { margin-top: .55em; }
    figure { margin: 24px 0; }
    img { display: block; max-width: 100%; height: auto; }
    .monospace { font-family: monospace; white-space: pre-wrap; }
    .italic { font-style: italic; }
    .empty-page, summary { color: #666; }
    .source-page { margin-top: 24px; }
    .source-page img { margin-top: 12px; }
    .conversion-notice { margin: 12px 0; padding: 12px 16px; background: #fff4d6; border-left: 4px solid #956300; }
    summary { cursor: pointer; }
  </style>
</head>
<body>
  <header><strong>${escapeHtml(title)}</strong><span>${pageCount} pages</span>
    <p><a href="/artifacts/">All artifacts</a> · <a href="original.pdf">Original PDF</a> · <a href="conversion-report.json">Conversion report</a></p>
    <p>Text and embedded images are reflowed for reading. ${pages.filter(page => page.notices.length).length} page(s) have conversion notices with links to the original PDF for checking graphics.</p>
  </header>
  <main>${content}</main>
</body>
</html>`
}

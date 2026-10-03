import { test, expect } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as mupdf from "mupdf"
import sharp from "sharp"

test("conversion preserves small/tall images and vector fallback, reflows prose, and links wrapped list references", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pdf-web-test-"))
  try {
    const doc = new mupdf.PDFDocument()
    const font = new mupdf.Font("Helvetica")
    const image = new mupdf.Image(await sharp({ create: { width: 40, height: 100, channels: 3, background: "red" } }).png().toBuffer())
    try {
      const resources = { Font: { F1: doc.addSimpleFont(font) }, XObject: { Im1: doc.addImage(image) } }
      const contents = [
        "BT /F1 10 Tf 14 TL 40 740 Td (A paragraph that wraps onto) Tj T* (another line without forced breaks.) Tj ET",
        "BT /F1 10 Tf 12 TL 40 660 Td (1. First topic \\(Page 2\\)) Tj T* (2. Second topic \\(Page) Tj T* (3\\)) Tj T* (3. Third topic \\(Page 1\\)) Tj ET",
        "q 15 0 0 15 40 580 cm /Im1 Do Q",
        "q 100 0 0 650 400 50 cm /Im1 Do Q",
        "q 0 0 1 rg 43 583 8 8 re f Q",
        "BT /F1 8 Tf 410 400 Td (OverlayLabel) Tj ET",
      ].join("\n")
      doc.insertPage(-1, doc.addPage([0, 0, 600, 800], 0, resources, contents))
      doc.insertPage(-1, doc.addPage([0, 0, 600, 800], 0, {}, "0 0 1 RG 3 w 40 40 m 200 300 l 400 100 l S"))
      doc.insertPage(-1, doc.addPage([0, 0, 600, 800], 0, resources, "BT /F1 12 Tf 40 700 Td (Last page) Tj ET"))
      doc.insertPage(-1, doc.addPage([0, 0, 600, 800], 0, resources,
        "q 600 0 0 800 0 0 cm /Im1 Do Q\nBT /F1 10 Tf 14 TL 40 740 Td " +
        Array.from({ length: 20 }, () => "(Readable prose over a page-sized background image.) Tj T*").join(" ") + " ET",
      ))
      doc.save(join(directory, "fixture.pdf"))
    } finally { image.destroy(); font.destroy(); doc.destroy() }
    const output = join(directory, "output")
    const result = Bun.spawnSync([process.execPath, "pdf-to-web.ts", join(directory, "fixture.pdf"), output], { cwd: import.meta.dir })
    expect(result.exitCode).toBe(0)
    const html = await Bun.file(join(output, "index.html")).text()
    expect(html).toContain("A paragraph that wraps onto another line without forced breaks.")
    const list = html.match(/<ol[^>]*>(.*?)<\/ol>/s)?.[1] ?? ""
    expect(list.match(/<li>/g)?.length).toBe(3)
    expect(list).toContain('href="#page-3">(Page 3)</a>')
    const report = await Bun.file(join(output, "conversion-report.json")).json()
    expect(report.pages[0].images).toBe(2)
    expect(report.pages[3].images).toBe(0)
    expect(report.pages[3].notices.join(" ")).toContain("background images")
    expect(html).toContain("Readable prose over a page-sized background image.")
    expect(report.pages[1].notices.join(" ").toLowerCase()).toContain("vector drawings")
    expect(report.pages[1].notices.join(" ")).toContain("No selectable text")
    expect(html).not.toContain('<details class="source-page"')
    expect(html).not.toContain('alt="Original PDF page')
    expect(await Bun.file(join(output, "assets/page-001.webp")).exists()).toBe(false)
    expect(html).toContain('href="original.pdf#page=2"')
    expect(html).not.toContain("OverlayLabel")
    const firstImage = html.match(/<img[^>]+src="([^"]+)" width="30"/)![1]
    const { data, info } = await sharp(join(output, firstImage)).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(info.width).toBe(30)
    expect(info.height).toBe(30)
    const center = (15 * info.width + 15) * info.channels
    // The source bitmap is red; a blue center proves the PDF vector overlay survived.
    expect([...data.subarray(center, center + 3)]).toEqual([0, 0, 255])
    for (const match of html.matchAll(/<img[^>]+src="([^"]+)"[^>]*>/g)) {
      expect(match[0]).toMatch(/width="\d+" height="\d+"/)
      expect(await Bun.file(join(output, match[1])).exists()).toBe(true)
    }
    expect(await Bun.file(join(output, "original.pdf")).bytes()).toEqual(await Bun.file(join(directory, "fixture.pdf")).bytes())
    const fullOutput = join(directory, "full-output")
    const fullResult = Bun.spawnSync([process.execPath, "pdf-to-web.ts", join(directory, "fixture.pdf"), fullOutput, "--full-pages"], { cwd: import.meta.dir })
    expect(fullResult.exitCode).toBe(0)
    expect(await Bun.file(join(fullOutput, "index.html")).text()).toContain('<details class="source-page">')
    expect(await Bun.file(join(fullOutput, "assets/page-001.jpg")).exists()).toBe(true)
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 30000)

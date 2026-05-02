import { db } from "@/db";
import { photos } from "@/db/schema";
import { eq, isNull, or } from "drizzle-orm";
import { readFile } from "fs/promises";
import path from "path";
import { imageSize } from "image-size";

const uploadDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(process.cwd(), "uploads");

async function backfill() {
  const rows = await db
    .select()
    .from(photos)
    .where(or(isNull(photos.width), isNull(photos.height)));

  console.log(`Found ${rows.length} photos without dimensions`);

  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    const filePath = path.join(uploadDir, row.filename);
    try {
      const buffer = await readFile(filePath);
      const dims = imageSize(buffer);
      if (dims.width && dims.height) {
        await db
          .update(photos)
          .set({ width: dims.width, height: dims.height })
          .where(eq(photos.id, row.id));
        updated++;
        console.log(`✓ ${row.filename} → ${dims.width}x${dims.height}`);
      } else {
        console.log(`⚠ ${row.filename} — dimensions not found`);
        failed++;
      }
    } catch (err) {
      console.log(`✗ ${row.filename} — ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, Failed: ${failed}`);
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});

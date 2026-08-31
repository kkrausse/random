import { NextRequest, NextResponse, connection } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { getUploadsDir } from "@/lib/uploads";
import { getImageContentType } from "@/lib/image-mime";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  await connection();
  const { filename } = await params;

  // Prevent path traversal
  if (filename.includes("..") || filename.includes("/")) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const filePath = path.join(getUploadsDir(), filename);

  try {
    const buffer = await readFile(filePath);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": getImageContentType(filename),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

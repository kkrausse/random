import { NextRequest, NextResponse, connection } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getImageContentType } from "@/lib/image-mime";
import { readStagedUpload } from "@/lib/uploads";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connection();
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const buffer = await readStagedUpload(userId, id);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": getImageContentType(id),
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

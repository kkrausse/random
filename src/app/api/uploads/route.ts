import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { stageUploadedFile } from "@/lib/uploads";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("photo");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No photo provided" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image uploads are supported" }, { status: 400 });
  }

  const uploaded = await stageUploadedFile(userId, file);
  return NextResponse.json(uploaded, { status: 201 });
}

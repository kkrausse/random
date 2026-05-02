import { NextResponse, connection } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getUserById } from "@/lib/users";
import { eq } from "drizzle-orm";

export async function GET() {
  await connection();

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserById(userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json(user);
}

export async function PUT(req: Request) {
  await connection();

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserById(userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid profile payload" }, { status: 400 });
  }

  const allowedFields = new Set(["bio"]);
  const unknownFields = Object.keys(body).filter((key) => !allowedFields.has(key));
  if (unknownFields.length > 0) {
    return NextResponse.json(
      { error: "Only app-owned profile fields can be updated" },
      { status: 400 }
    );
  }

  const { bio } = body as { bio?: unknown };
  if (bio !== undefined && typeof bio !== "string") {
    return NextResponse.json({ error: "Bio must be text" }, { status: 400 });
  }

  const trimmedBio = bio?.trim() || null;
  if (trimmedBio && trimmedBio.length > 1000) {
    return NextResponse.json(
      { error: "Bio must be 1000 characters or fewer" },
      { status: 400 }
    );
  }

  const [updatedUser] = await db
    .update(users)
    .set({ bio: trimmedBio })
    .where(eq(users.id, userId))
    .returning();

  return NextResponse.json(updatedUser);
}

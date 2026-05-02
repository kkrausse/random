import { NextResponse, connection } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getUserById } from "@/lib/users";

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

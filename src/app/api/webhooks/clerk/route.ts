import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  deriveAvailableMirroredUsername,
  deriveMirroredDisplayName,
} from "@/lib/clerk-user-mirror";
import { and, ne, sql } from "drizzle-orm";

type ClerkUserEventData = {
  id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
};

type ClerkWebhookEvent = {
  type: "user.created" | "user.updated";
  data: ClerkUserEventData;
};

export async function POST(req: NextRequest) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing svix headers" }, { status: 400 });
  }

  const body = await req.text();
  const wh = new Webhook(secret);
  let event: ClerkWebhookEvent;
  try {
    event = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type !== "user.created" && event.type !== "user.updated") {
    return NextResponse.json({ ok: true });
  }

  const { data } = event;
  // Clerk is authoritative for username/displayName. This route mirrors those
  // account fields into the app DB so joins and public profile URLs can resolve locally.
  // If Clerk has no username, use the same temporary id-derived, collision-checked
  // fallback as the backfill script. Configure Clerk sign-up to require usernames
  // so normal profiles never depend on the fallback.
  const username = await deriveAvailableMirroredUsername(data, async (candidate) => {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.username}) = lower(${candidate})`, ne(users.id, data.id)))
      .limit(1);
    return rows.length > 0;
  });
  const displayName = deriveMirroredDisplayName(data);

  await db
    .insert(users)
    .values({ id: data.id, username, displayName })
    .onConflictDoUpdate({
      target: users.id,
      set: { username, displayName },
    });

  return NextResponse.json({ ok: true });
}

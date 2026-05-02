import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { db } from "@/db";
import { users } from "@/db/schema";

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

function deriveUsername(data: ClerkUserEventData): string {
  if (data.username) return data.username;
  if (data.first_name) return data.first_name.toLowerCase().replace(/\s+/g, "");
  return `birder_${data.id.slice(-8)}`;
}

function deriveDisplayName(data: ClerkUserEventData): string {
  const parts = [data.first_name, data.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : deriveUsername(data);
}

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
  // Clerk is authoritative for username/displayName. This route only mirrors those
  // account fields into the app DB so joins and public profile URLs can resolve locally.
  const username = deriveUsername(data);
  const displayName = deriveDisplayName(data);

  await db
    .insert(users)
    .values({ id: data.id, username, displayName })
    .onConflictDoUpdate({
      target: users.id,
      set: { username, displayName },
    });

  return NextResponse.json({ ok: true });
}

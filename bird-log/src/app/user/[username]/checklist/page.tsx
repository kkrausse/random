import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getUserByUsername } from "@/lib/users";
import ChecklistClient from "./ChecklistClient";

export default function UserChecklistPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  return (
    <Suspense fallback={<div className="p-4 text-center text-gray-500">Loading checklist...</div>}>
      <UserChecklistContent params={params} />
    </Suspense>
  );
}

async function UserChecklistContent({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  await connection();
  const { username } = await params;

  const user = await getUserByUsername(username);
  if (!user) notFound();

  return (
    <ChecklistClient
      userId={user.id}
      username={user.username}
      displayName={user.displayName}
    />
  );
}

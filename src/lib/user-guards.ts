import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { getUserByUsername, type UserRow } from "@/lib/users";

export async function assertOwnUser(usernameParam: string): Promise<UserRow> {
  const user = await getUserByUsername(usernameParam);
  if (!user) notFound();

  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  if (userId !== user.id) {
    redirect(`/user/${user.username}`);
  }

  return user;
}

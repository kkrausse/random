import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { signInRoute, userRoute } from "@/lib/routes";
import { getUserByUsername, type UserRow } from "@/lib/users";

export async function assertOwnUser(usernameParam: string): Promise<UserRow> {
  const user = await getUserByUsername(usernameParam);
  if (!user) notFound();

  const { userId } = await auth();
  if (!userId) {
    redirect(signInRoute);
  }

  if (userId !== user.id) {
    redirect(userRoute(user.username));
  }

  return user;
}

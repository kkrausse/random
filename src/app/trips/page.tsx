import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getUserById } from "@/lib/users";

export default async function TripsPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/");
  }

  const user = await getUserById(userId);

  if (!user) {
    redirect("/");
  }

  redirect(`/user/${user.username}/trips`);
}

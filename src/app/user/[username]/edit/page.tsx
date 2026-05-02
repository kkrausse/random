import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getUserByUsername } from "@/lib/users";
import ProfileEditForm from "./ProfileEditForm";

export default async function EditProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  await connection();
  const { userId } = await auth();
  const { username } = await params;

  const user = await getUserByUsername(username);
  if (!user) notFound();

  if (!userId) {
    redirect("/sign-in");
  }

  if (userId !== user.id) {
    redirect(`/user/${user.username}`);
  }

  return (
    <main className="mx-auto max-w-2xl p-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Edit Profile</h1>
        <p className="mt-1 text-sm text-gray-500">@{user.username}</p>
      </div>
      <ProfileEditForm username={user.username} initialBio={user.bio ?? ""} />
    </main>
  );
}

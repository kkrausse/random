"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

interface Props {
  username: string;
  initialBio: string;
}

export default function ProfileEditForm({ username, initialBio }: Props) {
  const router = useRouter();
  const { openUserProfile } = useClerk();
  const [bio, setBio] = useState(initialBio);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bio }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || "Failed to update profile");
      }

      router.push(`/user/${username}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Bio
        </label>
        <Textarea
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          rows={6}
          maxLength={1000}
          placeholder="A short note about your birding."
        />
        <p className="mt-1 text-xs text-gray-500">{bio.length}/1000</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : "Save Profile"}
        </Button>
        <Button variant="outline" type="button" onClick={() => openUserProfile()}>
          Account settings
        </Button>
        <Button variant="ghost" asChild>
          <Link href={`/user/${username}`}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}

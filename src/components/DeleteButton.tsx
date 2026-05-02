"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeleteButton({ sightingId }: { sightingId: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  async function handleDelete() {
    const res = await fetch(`/api/sightings/${sightingId}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/");
    }
  }

  if (confirming) {
    return (
      <span className="flex items-center gap-2 text-sm">
        <span className="text-gray-600">Delete?</span>
        <button onClick={handleDelete} className="text-red-600 hover:underline">Yes</button>
        <button onClick={() => setConfirming(false)} className="text-gray-500 hover:underline">No</button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="text-red-600 hover:underline text-sm"
    >
      Delete
    </button>
  );
}

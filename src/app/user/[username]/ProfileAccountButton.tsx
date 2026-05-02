"use client";

import { UserButton } from "@clerk/nextjs";

export default function ProfileAccountButton() {
  return (
    <div className="flex justify-end">
      <UserButton />
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";

type MirroredUser = {
  id: string;
  username: string;
  displayName: string;
};

export function useMirroredUser() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [user, setUser] = useState<MirroredUser | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    const controller = new AbortController();

    fetch("/api/users/me", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as MirroredUser;
      })
      .then((mirroredUser) => {
        setUser(mirroredUser);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setUser(null);
      });

    return () => {
      controller.abort();
    };
  }, [isLoaded, isSignedIn, userId]);

  const mirroredUser = isSignedIn && user?.id === userId ? user : null;

  return {
    user: mirroredUser,
    loading: !isLoaded,
  };
}

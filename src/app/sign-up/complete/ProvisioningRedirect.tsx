"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";

type MeResponse = {
  username: string;
};

const MAX_ATTEMPTS = 12;
const RETRY_DELAY_MS = 1000;

export default function ProvisioningRedirect() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const [attempts, setAttempts] = useState(0);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      router.replace("/sign-in");
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function resolveMirroredUser(attempt: number) {
      try {
        const response = await fetch("/api/users/me", {
          cache: "no-store",
        });

        if (response.ok) {
          const user = (await response.json()) as MeResponse;
          router.replace(`/user/${user.username}`);
          return;
        }

        if (response.status === 401) {
          router.replace("/sign-in");
          return;
        }
      } catch {
        // Retry below. The provisioning gap is expected immediately after sign-up.
      }

      if (cancelled) return;

      const nextAttempt = attempt + 1;
      setAttempts(nextAttempt);

      if (nextAttempt >= MAX_ATTEMPTS) {
        setTimedOut(true);
        return;
      }

      timeoutId = setTimeout(() => {
        void resolveMirroredUser(nextAttempt);
      }, RETRY_DELAY_MS);
    }

    void resolveMirroredUser(0);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isLoaded, isSignedIn, router]);

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold text-gray-900">Finishing your profile</h1>
      {timedOut ? (
        <div className="mt-4 space-y-4 text-gray-600">
          <p>
            Your account is signed in, but the public profile row has not arrived yet.
            Refresh this page in a moment, or go to Explore while provisioning finishes.
          </p>
          <Link
            href="/"
            className="inline-flex rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
          >
            Go to Explore
          </Link>
        </div>
      ) : (
        <p className="mt-4 text-gray-600">
          Waiting for your account profile to be mirrored. This usually takes a few seconds.
          Attempt {Math.min(attempts + 1, MAX_ATTEMPTS)} of {MAX_ATTEMPTS}.
        </p>
      )}
    </section>
  );
}

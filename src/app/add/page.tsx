import { Suspense } from "react";
import { connection } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import SightingForm from "@/components/SightingForm";
import { signInRoute } from "@/lib/routes";

export default function AddPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; lat?: string; lng?: string; locationName?: string }>;
}) {
  return (
    <Suspense fallback={<div className="p-4 text-center text-gray-500">Loading...</div>}>
      <AddPageContent searchParams={searchParams} />
    </Suspense>
  );
}

async function AddPageContent({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; lat?: string; lng?: string; locationName?: string }>;
}) {
  await connection();
  const { userId } = await auth();
  if (!userId) redirect(signInRoute);

  const params = await searchParams;
  const prefill = {
    date: params.date,
    lat: params.lat ? parseFloat(params.lat) : undefined,
    lng: params.lng ? parseFloat(params.lng) : undefined,
    locationName: params.locationName,
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4 text-center">Log a Sighting</h1>
      <SightingForm prefill={prefill} />
    </div>
  );
}

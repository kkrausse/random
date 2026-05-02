import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import SightingForm from "@/components/SightingForm";

export default async function AddPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; lat?: string; lng?: string; locationName?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

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

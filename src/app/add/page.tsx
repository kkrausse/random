import SightingForm from "@/components/SightingForm";

export default function AddPage() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4 text-center">Log a Sighting</h1>
      <SightingForm />
    </div>
  );
}

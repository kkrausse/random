import { Skeleton } from "@/components/ui/skeleton";

export default function PhotoGridSkeleton() {
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
      {Array.from({ length: 12 }).map((_, i) => (
        <Skeleton key={i} className="aspect-square rounded-sm" />
      ))}
    </div>
  );
}

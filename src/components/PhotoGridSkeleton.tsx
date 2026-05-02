export default function PhotoGridSkeleton() {
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="aspect-square bg-gray-200 animate-pulse rounded-sm"
        />
      ))}
    </div>
  );
}

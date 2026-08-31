export default function Loading() {
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <div className="h-8 w-40 bg-gray-200 rounded animate-pulse" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="space-y-1">
          <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
          <div className="h-10 w-full bg-gray-200 rounded animate-pulse" />
        </div>
      ))}
      <div className="h-10 w-24 bg-gray-200 rounded animate-pulse" />
    </div>
  );
}

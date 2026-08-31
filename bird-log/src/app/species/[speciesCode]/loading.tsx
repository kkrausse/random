export default function Loading() {
  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="h-4 w-20 bg-gray-200 rounded animate-pulse mb-4" />
      <div className="h-8 w-40 bg-gray-200 rounded animate-pulse mb-2" />
      <div className="h-4 w-32 bg-gray-200 rounded animate-pulse mb-6" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="w-full h-48 bg-gray-200 rounded-lg animate-pulse" />
        ))}
      </div>
    </div>
  );
}

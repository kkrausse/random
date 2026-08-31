import Link from "next/link";
import { connection } from "next/server";
import { db } from "@/db";
import { sightings, users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

type SortMode = "recent" | "lifers";

function formatLastActivity(value: string | null) {
  if (!value) return "No sightings yet";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  return <UsersContent searchParams={searchParams} />;
}

async function UsersContent({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  await connection();
  const { sort } = await searchParams;
  const sortMode: SortMode = sort === "lifers" ? "lifers" : "recent";

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      sightingCount: sql<number>`count(${sightings.id})`,
      lifeListCount: sql<number>`count(distinct ${sightings.speciesCode})`,
      lastActivity: sql<string | null>`max(${sightings.createdAt})`,
    })
    .from(users)
    .leftJoin(sightings, eq(sightings.userId, users.id))
    .groupBy(users.id)
    .orderBy(
      sortMode === "lifers"
        ? sql`count(distinct ${sightings.speciesCode}) desc`
        : sql`max(${sightings.createdAt}) desc nulls last`,
      sql`${users.displayName} asc`
    );

  const tabClass = (active: boolean) =>
    `px-3 py-1.5 text-sm font-medium transition-colors ${
      active ? "bg-green-100 text-green-800" : "text-gray-600 hover:text-gray-900"
    }`;

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-bold">Birder Directory</h1>
          <p className="mt-1 text-sm text-gray-500">
            Browse public profiles by recent activity or lifer count.
          </p>
        </div>

        <div className="flex items-center rounded-lg border border-gray-200 bg-white p-1">
          <Link href="/users" className={tabClass(sortMode === "recent")}>
            Recent
          </Link>
          <Link href="/users?sort=lifers" className={tabClass(sortMode === "lifers")}>
            Lifers
          </Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-gray-500">
            No users yet.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {rows.map((row) => (
              <Link
                key={row.id}
                href={`/user/${row.username}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-gray-50"
              >
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">
                    {row.displayName}
                  </div>
                  <div className="text-sm text-gray-500 truncate">
                    @{row.username}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-4 text-sm text-gray-600">
                  <span>
                    <span className="font-semibold text-gray-900">
                      {row.lifeListCount}
                    </span>{" "}
                    lifers
                  </span>
                  <span>
                    <span className="font-semibold text-gray-900">
                      {row.sightingCount}
                    </span>{" "}
                    sightings
                  </span>
                  <span className="hidden sm:inline text-gray-500">
                    {formatLastActivity(row.lastActivity)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

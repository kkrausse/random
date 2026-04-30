import { NextRequest, NextResponse } from "next/server";
import { searchSpecies, countSpecies } from "@/lib/species";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0", 10);
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "20", 10);
  if (q.length < 1) {
    return NextResponse.json({ results: [], total: 0 });
  }
  const results = searchSpecies(q, limit, offset);
  const total = countSpecies(q);
  return NextResponse.json({ results, total });
}

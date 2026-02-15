import { NextRequest, NextResponse } from "next/server";
import { searchSpecies } from "@/lib/species";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  if (q.length < 1) {
    return NextResponse.json([]);
  }
  const results = searchSpecies(q, 10);
  return NextResponse.json(results);
}

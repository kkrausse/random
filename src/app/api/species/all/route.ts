import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
  const filePath = path.join(process.cwd(), "data", "species.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  const species = JSON.parse(raw);
  return NextResponse.json(species);
}

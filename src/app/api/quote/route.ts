import { NextResponse } from "next/server";
import { quoteFor } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { csv?: unknown };
  if (typeof body.csv !== "string") return NextResponse.json({ error: "csv must be a string" }, { status: 400 });
  try {
    return NextResponse.json(await quoteFor(body.csv));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/auth/guard";
import { quoteFor } from "@/server/runtime";

export const dynamic = "force-dynamic";

/** Admin. Free. Prices a CSV from the public catalog and shows the server's cap. */
export async function POST(req: Request) {
  const gate = await requireAdminRoute(req);
  if (gate) return gate;
  const body = (await req.json().catch(() => ({}))) as { csv?: unknown };
  if (typeof body.csv !== "string") return NextResponse.json({ error: "csv must be a string" }, { status: 400 });
  try {
    return NextResponse.json(await quoteFor(body.csv), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

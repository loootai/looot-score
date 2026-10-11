import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/auth/guard";
import { getIcp, setIcp } from "@/server/runtime";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Admin. Reads the ICP in force. */
export async function GET(req: Request) {
  const gate = await requireAdminRoute(req);
  if (gate) return gate;
  return NextResponse.json(await getIcp(), { headers: NO_STORE });
}

/** Admin. Rewrites the ICP. Needs the session and the CSRF token. */
export async function PUT(req: Request) {
  const gate = await requireAdminRoute(req);
  if (gate) return gate;
  const raw = await req.json().catch(() => null);
  try {
    return NextResponse.json(await setIcp(raw), { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400, headers: NO_STORE });
  }
}

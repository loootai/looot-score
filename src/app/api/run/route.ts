import { NextResponse } from "next/server";
import { checkAdmin, denied, requireAdminRoute } from "@/lib/auth/guard";
import { canRunLive, isDemo, runFor, RunLimitError } from "@/server/runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Admin. Paid. Needs the session and the CSRF token. The body carries the CSV only. The spend cap is the server's
 * (LOOOT_SCORE_CAP_USD), so a `capUsd` in the body is ignored. The run is refused when the quote is above that cap.
 */
export async function POST(req: Request) {
  const gate = await requireAdminRoute(req);
  if (gate) return gate;
  const check = await checkAdmin(req.method, req.headers);
  if (!check.ok) return denied(check);
  const body = (await req.json().catch(() => ({}))) as { csv?: unknown };
  if (typeof body.csv !== "string") return NextResponse.json({ error: "csv must be a string" }, { status: 400, headers: NO_STORE });
  if (!isDemo() && !canRunLive()) return NextResponse.json({ error: "LOOOT_TOKEN is not set on the server. Set it, or start the demo with npm run demo." }, { status: 503, headers: NO_STORE });
  try {
    return NextResponse.json(await runFor({ csv: body.csv, sid: check.sid }), { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof RunLimitError ? 429 : 400, headers: NO_STORE });
  }
}

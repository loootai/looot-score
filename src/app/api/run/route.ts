import { NextResponse } from "next/server";
import { canRunLive, isDemo, runFor } from "@/server/runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { csv?: unknown; capUsd?: unknown };
  if (typeof body.csv !== "string") return NextResponse.json({ error: "csv must be a string" }, { status: 400 });
  const capUsd = Number(body.capUsd);
  if (!Number.isFinite(capUsd) || capUsd < 0) return NextResponse.json({ error: "capUsd must be a dollar amount" }, { status: 400 });
  if (!isDemo() && !canRunLive()) return NextResponse.json({ error: "LOOOT_TOKEN is not set on the server. Set it, or start the demo with npm run demo." }, { status: 503 });
  try {
    return NextResponse.json(await runFor({ csv: body.csv, capUsd }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

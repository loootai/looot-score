import { NextResponse } from "next/server";
import { getIcp, setIcp } from "@/server/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getIcp());
}

export async function PUT(req: Request) {
  const raw = await req.json().catch(() => null);
  try {
    return NextResponse.json(await setIcp(raw));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

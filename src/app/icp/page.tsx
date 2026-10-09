import type { Metadata } from "next";
import { IcpEditor } from "@/components/IcpEditor";
import { distribution } from "@/engine/score";
import { getScores, isDemo } from "@/server/runtime";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ICP editor" };

export default async function IcpPage() {
  const { icp, scores } = await getScores();
  const d = distribution(scores);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-20 font-medium tracking-tight">ICP editor</h1>
        <p className="mt-1 max-w-3xl text-mute">
          Who counts as a good fit, in points. Enrichment is stored, so saving re-scores the leads you already enriched and costs nothing.
          {scores.length > 0 && <> Right now: A {d.A}, B {d.B}, C {d.C}, D {d.D}.</>}
        </p>
      </div>
      <IcpEditor key={JSON.stringify(icp)} initial={icp} saveNote={isDemo() ? "Demo mode keeps the edit in memory until the server restarts." : "Writes config/icp.json, which the CLI reads too."} />
    </div>
  );
}

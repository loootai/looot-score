import { CostPanel } from "@/components/CostPanel";
import { GradeChart } from "@/components/GradeChart";
import { LeadTable } from "@/components/LeadTable";
import { UploadPanel } from "@/components/UploadPanel";
import { distribution } from "@/engine/score";
import { canRunLive, getScores, isDemo, sampleCsv } from "@/server/runtime";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { scores, icp, state } = await getScores();
  const run = state.run;
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-20 font-medium tracking-tight">Lead fit</h1>
        <p className="mt-1 max-w-3xl text-mute">
          Upload leads, enrich them through looot and grade them A to D against your ICP: <span className="text-ink">{icp.name}</span>. Every grade lists the facts behind it and which provider supplied each one. The quote comes before the run.
        </p>
      </div>
      <UploadPanel initialCsv={sampleCsv()} demo={isDemo()} canRun={canRunLive()} />
      {run && scores.length > 0 ? (
        <>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
            <GradeChart counts={distribution(scores)} cutoffs={{ A: `A from ${icp.grades.A}`, B: `B from ${icp.grades.B}`, C: `C from ${icp.grades.C}`, D: `D below ${icp.grades.C}` }} />
            <CostPanel run={run} />
          </div>
          <LeadTable scores={scores} />
        </>
      ) : (
        <p className="rounded-panel border border-dashed border-line-strong p-8 text-center text-mute">No run yet. Upload a CSV above, get a quote, then run.</p>
      )}
    </div>
  );
}

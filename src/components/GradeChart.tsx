import type { Grade } from "@/engine/types";
import { cn } from "@/lib/cn";

const FILL: Record<Grade, string> = { A: "bg-brand", B: "bg-emerald", C: "bg-amber", D: "bg-k-grey" };

/** Leads per grade as horizontal bars, with the score cut-off for each grade. */
export function GradeChart({ counts, cutoffs }: { counts: Record<Grade, number>; cutoffs: Record<Grade, string> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...Object.values(counts));
  return (
    <section aria-label="Grade distribution" className="rounded-panel border border-line bg-panel p-4">
      <h2 className="text-16 font-medium">Grade distribution</h2>
      <ul className="mt-3 grid gap-2">
        {(["A", "B", "C", "D"] as Grade[]).map((g) => (
          <li key={g} className="grid grid-cols-[20px_1fr_72px] items-center gap-3">
            <span className="text-13 font-semibold">{g}</span>
            <div className="h-5 overflow-hidden rounded-control bg-hover" role="img" aria-label={`${counts[g]} leads graded ${g}`}>
              <div className={cn("h-full rounded-control", FILL[g])} style={{ width: `${(counts[g] / max) * 100}%` }} />
            </div>
            <span className="num text-right text-13">{counts[g]} <span className="text-faint">{total ? `${Math.round((counts[g] / total) * 100)}%` : ""}</span></span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-12 text-mute">{cutoffs.A}, {cutoffs.B}, {cutoffs.C}. Edit the cut-offs in the ICP editor.</p>
    </section>
  );
}

"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { usdPrecise } from "@/engine/money";
import type { Grade, LeadScore } from "@/engine/types";
import { cn } from "@/lib/cn";
import { Bar, GradeChip } from "./chips";

const GRADES: Grade[] = ["A", "B", "C", "D"];

const nameOf = (s: LeadScore) => [s.lead.firstName, s.lead.lastName].filter(Boolean).join(" ");

/** Leads ranked by score with a grade filter. A row opens to the reasons: points, the fact and the provider. */
export function LeadTable({ scores }: { scores: LeadScore[] }) {
  const [grade, setGrade] = useState<Grade | "all">("all");
  const [open, setOpen] = useState<string | null>(scores[0]?.lead.id ?? null);
  const counts = useMemo(() => Object.fromEntries(GRADES.map((g) => [g, scores.filter((s) => s.grade === g).length])) as Record<Grade, number>, [scores]);
  const rows = scores.map((s, i) => ({ s, rank: i + 1 })).filter((r) => grade === "all" || r.s.grade === grade);
  return (
    <section aria-label="Scored leads">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-16 font-medium">Leads</h2>
        {(["all", ...GRADES] as const).map((g) => (
          <button key={g} type="button" onClick={() => setGrade(g)} aria-pressed={grade === g} className={cn("rounded-full border px-2.5 py-0.5 text-12", grade === g ? "border-brand bg-brand text-brand-ink" : "border-line-strong text-mute hover:bg-hover")}>
            {g === "all" ? "All" : `Grade ${g}`}{g !== "all" && <span className="num ml-1 opacity-70">{counts[g]}</span>}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-panel border border-line bg-panel">
        <table className="w-full min-w-[800px] text-left text-13">
          <thead className="border-b border-line text-12 text-mute">
            <tr><th className="w-8 px-2 py-2" /><th className="w-10 px-2 py-2 font-medium">#</th><th className="px-3 py-2 font-medium">Lead</th><th className="px-3 py-2 font-medium">Company</th><th className="w-40 px-3 py-2 font-medium">Score</th><th className="px-3 py-2 font-medium">Grade</th><th className="px-3 py-2 font-medium">Facts known</th><th className="px-3 py-2 text-right font-medium">Cost</th></tr>
          </thead>
          <tbody>
            {rows.map(({ s, rank }) => {
              const isOpen = open === s.lead.id;
              return (
                <Fragment key={s.lead.id}>
                  <tr className="cursor-pointer border-t border-line hover:bg-hover" onClick={() => setOpen(isOpen ? null : s.lead.id)}>
                    <td className="px-2 py-2"><button type="button" aria-expanded={isOpen} aria-label={`Reasons for ${s.lead.email ?? nameOf(s)}`} className="grid size-6 place-items-center text-mute"><ChevronRight size={14} className={cn("transition-transform", isOpen && "rotate-90")} /></button></td>
                    <td className="num px-2 py-2 text-mute">{rank}</td>
                    <td className="px-3 py-2"><div className="font-medium">{nameOf(s) || s.lead.email}</div>{nameOf(s) && s.lead.email && <div className="text-12 text-mute">{s.lead.email}</div>}</td>
                    <td className="px-3 py-2 text-mute">{s.lead.domain ?? "unknown"}</td>
                    <td className="px-3 py-2"><div className="flex items-center gap-2"><span className="num w-8 text-right font-medium">{s.score}</span><Bar value={s.score} max={100} /></div></td>
                    <td className="px-3 py-2"><GradeChip grade={s.grade} />{s.disqualified && <span className="ml-2 text-11 text-high">capped</span>}{s.pending && <span className="ml-2 text-11 text-amber">pending</span>}</td>
                    <td className="num px-3 py-2 text-mute">{s.coverage.known}/{s.coverage.active}</td>
                    <td className="num px-3 py-2 text-right text-mute">{usdPrecise(s.costMicros)}</td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-page">
                      <td />
                      <td colSpan={7} className="px-3 py-3">
                        {s.disqualified && <p className="mb-2 rounded-control bg-high-soft px-3 py-1.5 text-12 text-high">Grade capped at D. {s.disqualified}</p>}
                        <table className="w-full text-12">
                          <tbody>
                            {s.reasons.map((r) => (
                              <tr key={r.component} className="border-t border-line first:border-0">
                                <td className="w-32 py-1.5 pr-3 font-medium">{r.label}</td>
                                <td className="num w-24 py-1.5 pr-3 text-right">{r.points.toFixed(1)} / {r.max.toFixed(0)}</td>
                                <td className="w-28 py-1.5 pr-3"><Bar value={r.points} max={r.max} /></td>
                                <td className={cn("py-1.5 pr-3", r.known ? "text-ink" : "text-faint")}>{r.detail}</td>
                                <td className="w-32 py-1.5 text-right text-mute">{r.provider ?? "no provider"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-mute">No leads with this grade.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

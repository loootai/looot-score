import { usd, usdPrecise } from "./money";
import { distribution } from "./score";
import type { EnrichRun, LeadScore } from "./types";

const q = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One sentence per scored component: label, points, detail, provider. */
export function reasonText(s: LeadScore): string {
  const parts = s.reasons.map((r) => `${r.label} ${r.points.toFixed(1)}/${r.max.toFixed(0)}: ${r.detail}${r.provider ? ` (${r.provider})` : ""}`);
  return (s.disqualified ? [`Capped at D: ${s.disqualified}`, ...parts] : parts).join(" | ");
}

/** One row per lead, best first. */
export function toCsv(scores: LeadScore[]): string {
  const head = ["rank", "email", "first_name", "last_name", "domain", "score", "grade", "disqualified", "components_known", "cost_usd", "reasons"];
  const rows = scores.map((s, i) => [i + 1, s.lead.email ?? "", s.lead.firstName ?? "", s.lead.lastName ?? "", s.lead.domain ?? "", s.score, s.grade, s.disqualified ?? "", `${s.coverage.known}/${s.coverage.active}`, (s.costMicros / 1e6).toFixed(5), reasonText(s)]);
  return [head, ...rows].map((r) => r.map(q).join(",")).join("\n") + "\n";
}

/** A markdown report: grade counts, the cost, then a table of leads with their reasons. */
export function toMarkdown(run: EnrichRun, scores: LeadScore[]): string {
  const d = distribution(scores);
  const out = ["# Lead fit report", ""];
  out.push(`Run ${run.runId}${run.demo ? " (demo data, no looot calls)" : ""}. ${scores.length} leads. Quoted ${usd(run.quotedMicros)} at list price, spent ${usd(run.spentMicros)}, cap ${usd(run.capMicros)}.`);
  if (run.pendingCalls) out.push("", `${run.pendingCalls} calls were still running when waiting stopped. They are pending, not failed. Run again in the same window to collect them without a second charge.`);
  if (run.skippedByCap) out.push("", `${run.skippedByCap} calls were skipped because the spend cap would have been passed.`);
  if (run.aborted) out.push("", run.aborted);
  out.push("", `Grades: A ${d.A}, B ${d.B}, C ${d.C}, D ${d.D}.`, "");
  out.push("| # | Lead | Score | Grade | Known | Cost | Why |", "| --- | --- | --- | --- | --- | --- | --- |");
  scores.forEach((s, i) => out.push(`| ${i + 1} | ${s.lead.email ?? (s.lead.firstName && s.lead.lastName ? `${s.lead.firstName} ${s.lead.lastName} at ${s.lead.domain}` : (s.lead.company ?? s.lead.domain))} | ${s.score} | ${s.grade} | ${s.coverage.known}/${s.coverage.active} | ${usdPrecise(s.costMicros)} | ${reasonText(s).replace(/\|/g, "/")} |`));
  return out.join("\n") + "\n";
}

/** The JSON a script or an agent reads: the run, the ICP name and every score. */
export function toJson(run: EnrichRun, scores: LeadScore[]): string {
  return JSON.stringify({ run: { ...run, profiles: undefined }, scores }, null, 2) + "\n";
}

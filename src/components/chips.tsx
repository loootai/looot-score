import { cn } from "@/lib/cn";
import type { CallStatus, Grade } from "@/engine/types";

const GRADE_STYLE: Record<Grade, string> = {
  A: "bg-brand text-brand-ink",
  B: "bg-brand-soft text-link",
  C: "bg-amber-soft text-amber",
  D: "bg-low-soft text-low",
};

/** The fit grade as a square badge. */
export function GradeChip({ grade, className }: { grade: Grade; className?: string }) {
  return <span className={cn("inline-grid size-6 place-items-center rounded-control text-13 font-semibold", GRADE_STYLE[grade], className)}>{grade}</span>;
}

const STATUS_LABEL: Record<CallStatus, string> = { ok: "ok", failed: "failed", pending: "pending", skipped_cap: "skipped, cap", skipped_price: "skipped, price", parse_error: "unreadable" };

/** A call status. Only the ones that need attention are drawn loud. */
export function StatusChip({ status }: { status: CallStatus }) {
  if (status === "ok") return <span className="text-12 text-faint">ok</span>;
  const tone = status === "pending" ? "bg-amber-soft text-amber" : "bg-high-soft text-high";
  return <span className={cn("rounded-full px-1.5 py-0.5 text-11 font-medium", tone)}>{STATUS_LABEL[status]}</span>;
}

/** A horizontal bar for a value out of a maximum. */
export function Bar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-hover", className)} role="presentation">
      <div className="h-full rounded-full bg-emerald" style={{ width: `${pct}%` }} />
    </div>
  );
}

import { usd, usdPrecise } from "@/engine/money";
import type { CallKind, EnrichRun } from "@/engine/types";
import { Bar, StatusChip } from "./chips";

/** What the run cost: quote against spend and cap, and the spend per provider call. */
export function CostPanel({ run }: { run: EnrichRun }) {
  const per = new Map<CallKind, { cost: number; ok: number; pending: number; failed: number; skipped: number }>();
  for (const p of run.profiles) {
    for (const c of p.calls) {
      if (c.shared) continue;
      const x = per.get(c.kind) ?? { cost: 0, ok: 0, pending: 0, failed: 0, skipped: 0 };
      x.cost += c.costMicros;
      if (c.status === "ok") x.ok += 1;
      else if (c.status === "pending") x.pending += 1;
      else if (c.status === "skipped_cap" || c.status === "skipped_price") x.skipped += 1;
      else x.failed += 1;
      per.set(c.kind, x);
    }
  }
  const leads = run.profiles.length;
  return (
    <section aria-label="Cost" className="rounded-panel border border-line bg-panel p-4">
      <h2 className="text-16 font-medium">Cost</h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Quoted at list price", usd(run.quotedMicros)],
          ["Spent", usd(run.spentMicros)],
          ["Spend cap", usd(run.capMicros)],
          ["Per lead", usdPrecise(leads ? Math.round(run.quotedMicros / leads) : 0)],
        ].map(([k, v]) => (
          <div key={k}><dt className="text-12 text-mute">{k}</dt><dd className="num text-20 font-medium">{v}</dd></div>
        ))}
      </dl>
      <div className="mt-3"><Bar value={run.spentMicros} max={run.capMicros} /></div>
      <p className="mt-2 text-12 text-mute">
        {run.demo ? "Demo data. No looot call was made, so the spend is zero. The quote is what the same run costs live." : "Spend is what looot charged. A failed call costs nothing."}
        {run.pendingCalls > 0 && ` ${run.pendingCalls} calls are still running at the provider. They are pending, not failed. Run again in the same window to collect them without a second charge.`}
        {run.skippedByCap > 0 && ` ${run.skippedByCap} calls were skipped because the cap would have been passed.`}
        {" Re-scoring after an ICP edit makes no call and costs nothing."}
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-12">
          <thead className="text-mute"><tr><th className="py-1 pr-3 font-medium">Call</th><th className="py-1 pr-3 font-medium">Provider</th><th className="py-1 pr-3 text-right font-medium">List price</th><th className="py-1 pr-3 text-right font-medium">Calls ok</th><th className="py-1 pr-3 font-medium">Other</th><th className="py-1 text-right font-medium">Spent</th></tr></thead>
          <tbody>
            {run.quote.lines.map((l) => {
              const x = per.get(l.kind);
              return (
                <tr key={l.kind} className="border-t border-line">
                  <td className="py-1 pr-3">{l.label}</td><td className="py-1 pr-3 text-mute">{l.provider}</td>
                  <td className="num py-1 pr-3 text-right">{usdPrecise(l.priceMicros)}</td><td className="num py-1 pr-3 text-right">{x?.ok ?? 0}/{l.calls}</td>
                  <td className="py-1 pr-3 text-mute">
                    {x?.pending ? <span className="mr-1"><StatusChip status="pending" /> {x.pending}</span> : null}
                    {x?.failed ? <span className="mr-1"><StatusChip status="failed" /> {x.failed}</span> : null}
                    {x?.skipped ? <span><StatusChip status="skipped_cap" /> {x.skipped}</span> : null}
                  </td>
                  <td className="num py-1 text-right">{usdPrecise(x?.cost ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

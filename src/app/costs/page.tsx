import type { Metadata } from "next";
import { BudgetForm } from "@/components/BudgetForm";
import { BudgetPanel } from "@/components/BudgetPanel";
import { CostPanel } from "@/components/CostPanel";
import { MICROS } from "@/engine/money";
import { requireAdminPage } from "@/lib/auth/guard";
import { budgetStatus, getState, isDemo, serverCapUsd } from "@/server/runtime";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Costs and budget" };

export default async function CostsPage() {
  await requireAdminPage();
  const [status, state] = await Promise.all([budgetStatus(), getState()]);
  return (
    <div className="grid grid-cols-1 gap-6">
      <div>
        <h1 className="text-20 font-medium tracking-tight">Costs and budget</h1>
        <p className="mt-1 max-w-3xl text-mute">
          Every run is held to a cap per run (${serverCapUsd().toFixed(2)}, set on the server), then to a daily and a monthly budget. Each call reserves its list price first and settles to the real cost.
        </p>
      </div>
      <BudgetPanel status={status} />
      <BudgetForm key={`${status.limits.dailyMicros}:${status.limits.monthlyMicros}`} dailyUsd={status.limits.dailyMicros / MICROS} monthlyUsd={status.limits.monthlyMicros / MICROS} disabled={isDemo()} />
      {state.run ? <CostPanel run={state.run} /> : <p className="rounded-panel border border-dashed border-line-strong p-8 text-center text-mute">No run yet.</p>}
    </div>
  );
}

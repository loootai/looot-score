"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Icp } from "@/engine/icp";
import { adminFetch } from "@/components/adminFetch";

const csv = (a: string[]) => a.join(", ");
const toList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const LEVELS = ["c_suite", "vp", "head", "director", "manager", "senior", "entry"];

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-12 font-medium text-mute">{label}</span>
      {children}
      {hint && <span className="text-11 text-faint">{hint}</span>}
    </label>
  );
}
const inputCls = "w-full rounded-control border border-line-strong bg-page px-2 py-1.5 text-13";

function Num({ value, onChange, step }: { value: number; onChange: (n: number) => void; step?: number }) {
  return <input type="number" step={step} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Number(e.target.value))} className={`${inputCls} num`} />;
}
function Words({ value, onChange }: { value: string[]; onChange: (a: string[]) => void }) {
  return <input defaultValue={csv(value)} onBlur={(e) => onChange(toList(e.target.value))} className={inputCls} />;
}

function Block({ title, points, onPoints, children }: { title: string; points: number; onPoints: (n: number) => void; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3 rounded-panel border border-line bg-panel p-4">
      <legend className="px-1 text-14 font-medium">{title}</legend>
      <div className="max-w-40"><Field label="Points"><Num value={points} onChange={onPoints} /></Field></div>
      {children}
    </fieldset>
  );
}

/** Edits every part of the ICP. Saving re-scores the stored leads at no cost. */
export function IcpEditor({ initial, saveNote }: { initial: Icp; saveNote: string }) {
  const router = useRouter();
  const [icp, setIcp] = useState<Icp>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const c = icp.components;
  const set = (fn: (d: Icp) => void) => setIcp((prev) => { const d = structuredClone(prev); fn(d); return d; });
  const active = [c.employees.points, c.industry.include.length || c.industry.exclude.length ? c.industry.points : 0, c.geography.include.length ? c.geography.points : 0, c.title.include.length || c.title.exclude.length ? c.title.points : 0, c.seniority.points, c.tech.include.length || c.tech.exclude.length ? c.tech.points : 0].reduce((a, b) => a + b, 0);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await adminFetch("/api/icp", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(icp) });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setMsg({ ok: true, text: "Saved. Every stored lead is re-scored with the new ICP. No looot call was made." });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto_auto]">
        <Field label="ICP name"><input value={icp.name} onChange={(e) => set((d) => { d.name = e.target.value; })} className={inputCls} /></Field>
        {(["A", "B", "C"] as const).map((g) => (
          <div key={g} className="w-28"><Field label={`Grade ${g} from score`}><Num value={icp.grades[g]} onChange={(n) => set((d) => { d.grades[g] = n; })} /></Field></div>
        ))}
      </div>
      <p className="text-12 text-mute">Points of the criteria in use add up to {active}. The score is points earned over points in use, scaled to 100. A criterion with an empty list is not in use.</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Block title="Company size" points={c.employees.points} onPoints={(n) => set((d) => { d.components.employees.points = n; })}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ideal from"><Num value={c.employees.ideal[0]} onChange={(n) => set((d) => { d.components.employees.ideal[0] = n; })} /></Field>
            <Field label="Ideal to"><Num value={c.employees.ideal[1]} onChange={(n) => set((d) => { d.components.employees.ideal[1] = n; })} /></Field>
            <Field label="Acceptable from" hint="Half the points inside this range."><Num value={c.employees.acceptable[0]} onChange={(n) => set((d) => { d.components.employees.acceptable[0] = n; })} /></Field>
            <Field label="Acceptable to"><Num value={c.employees.acceptable[1]} onChange={(n) => set((d) => { d.components.employees.acceptable[1] = n; })} /></Field>
          </div>
        </Block>
        <Block title="Industry" points={c.industry.points} onPoints={(n) => set((d) => { d.components.industry.points = n; })}>
          <Field label="Target industries" hint="Comma separated. Whole words, any case."><Words value={c.industry.include} onChange={(a) => set((d) => { d.components.industry.include = a; })} /></Field>
          <Field label="Excluded industries"><Words value={c.industry.exclude} onChange={(a) => set((d) => { d.components.industry.exclude = a; })} /></Field>
        </Block>
        <Block title="Country" points={c.geography.points} onPoints={(n) => set((d) => { d.components.geography.points = n; })}>
          <Field label="Target countries" hint="Two-letter codes or names."><Words value={c.geography.include} onChange={(a) => set((d) => { d.components.geography.include = a; })} /></Field>
        </Block>
        <Block title="Job title" points={c.title.points} onPoints={(n) => set((d) => { d.components.title.points = n; })}>
          <Field label="Target title words"><Words value={c.title.include} onChange={(a) => set((d) => { d.components.title.include = a; })} /></Field>
          <Field label="Excluded title words"><Words value={c.title.exclude} onChange={(a) => set((d) => { d.components.title.exclude = a; })} /></Field>
        </Block>
        <Block title="Seniority" points={c.seniority.points} onPoints={(n) => set((d) => { d.components.seniority.points = n; })}>
          <div className="grid grid-cols-4 gap-2">
            {LEVELS.map((l) => (
              <Field key={l} label={l.replace("_", "-")}><Num step={0.1} value={c.seniority.levels[l] ?? 0} onChange={(n) => set((d) => { d.components.seniority.levels[l] = n; })} /></Field>
            ))}
          </div>
          <p className="text-11 text-faint">Share of the points each level earns, 0 to 1.</p>
        </Block>
        <Block title="Tech stack" points={c.tech.points} onPoints={(n) => set((d) => { d.components.tech.points = n; })}>
          <Field label="Target technologies"><Words value={c.tech.include} onChange={(a) => set((d) => { d.components.tech.include = a; })} /></Field>
          <Field label="Excluded technologies" hint="One match scores the component zero."><Words value={c.tech.exclude} onChange={(a) => set((d) => { d.components.tech.exclude = a; })} /></Field>
          <div className="max-w-40"><Field label="Matches for full points"><Num value={c.tech.minMatches} onChange={(n) => set((d) => { d.components.tech.minMatches = n; })} /></Field></div>
          <p className="text-11 text-faint">With both lists empty the tech call is not made and not paid for.</p>
        </Block>
      </div>

      <fieldset className="grid gap-3 rounded-panel border border-line bg-panel p-4">
        <legend className="px-1 text-14 font-medium">Hard rules, cap the grade at D</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Disqualified industries"><Words value={icp.disqualify.industries} onChange={(a) => set((d) => { d.disqualify.industries = a; })} /></Field>
          <Field label="Disqualified title words"><Words value={icp.disqualify.titles} onChange={(a) => set((d) => { d.disqualify.titles = a; })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-13"><input type="checkbox" checked={icp.disqualify.personalEmailDomains} onChange={(e) => set((d) => { d.disqualify.personalEmailDomains = e.target.checked; })} /> Personal email address with no company domain (gmail.com and similar)</label>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className="rounded-control bg-brand px-4 py-1.5 font-medium text-brand-ink hover:opacity-90 disabled:opacity-50">Save and re-score</button>
        <span className="text-12 text-mute">{saveNote}</span>
        {msg && <span role="status" className={msg.ok ? "text-12 text-link" : "text-12 text-high"}>{msg.text}</span>}
      </div>
    </div>
  );
}

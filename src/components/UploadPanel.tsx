"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { usd, usdPrecise } from "@/engine/money";
import type { Quote } from "@/engine/types";

interface QuoteReply {
  quote: Quote;
  rejected: string[];
  leads: number;
  unpriced: string[];
}

/** Upload or paste a leads CSV. Shows the quote before anything is bought, then runs the enrichment. */
export function UploadPanel({ initialCsv, demo, canRun }: { initialCsv: string; demo: boolean; canRun: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState(initialCsv);
  const [cap, setCap] = useState("5");
  const [reply, setReply] = useState<QuoteReply | null>(null);
  const [quotedFor, setQuotedFor] = useState("");
  const [busy, setBusy] = useState<"quote" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const capNum = Number(cap);
  const total = reply?.quote.totalMicros ?? 0;
  const fresh = reply !== null && quotedFor === csv;
  const overCap = fresh && total > capNum * 1_000_000;

  async function post(path: string, body: unknown) {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json;
  }

  async function getQuote() {
    setBusy("quote");
    setError(null);
    try {
      setReply((await post("/api/quote", { csv })) as unknown as QuoteReply);
      setQuotedFor(csv);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    setBusy("run");
    setError(null);
    try {
      await post("/api/run", { csv, capUsd: capNum });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-panel border border-line bg-panel p-4" aria-label="Score leads">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="grid gap-1">
          <div className="flex items-center justify-between">
            <label htmlFor="csv" className="text-12 font-medium text-mute">Leads CSV. An email column, or name columns and a domain column.</label>
            <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-1 rounded-control border border-line-strong px-2 py-0.5 text-12 hover:bg-hover"><Upload size={12} /> Upload file</button>
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); e.target.value = ""; }} />
          </div>
          <textarea id="csv" value={csv} onChange={(e) => setCsv(e.target.value)} rows={7} spellCheck={false} className="num w-full resize-y whitespace-pre rounded-control border border-line-strong bg-page p-2 text-12 leading-5" />
        </div>
        <div className="grid content-start gap-3 lg:w-48">
          <label className="grid gap-1">
            <span className="text-12 font-medium text-mute">Spend cap, USD</span>
            <input value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" className="num w-full rounded-control border border-line-strong bg-page px-2 py-1.5 text-13" />
          </label>
          <button type="button" onClick={getQuote} disabled={busy !== null} className="rounded-control border border-line-strong bg-panel px-3 py-1.5 font-medium hover:bg-hover disabled:opacity-50">
            {busy === "quote" ? <Loader2 className="mx-auto size-4 animate-spin" /> : "Get quote"}
          </button>
          <button type="button" onClick={run} disabled={busy !== null || !fresh || overCap || !Number.isFinite(capNum) || (!demo && !canRun)} className="rounded-control bg-brand px-3 py-1.5 font-medium text-brand-ink hover:opacity-90 disabled:opacity-40">
            {busy === "run" ? <Loader2 className="mx-auto size-4 animate-spin" /> : demo ? "Score sample leads" : "Enrich and score"}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 rounded-control bg-high-soft px-3 py-2 text-high">{error}</p>}
      {!demo && !canRun && <p className="mt-3 text-12 text-mute">LOOOT_TOKEN is not set on the server, so the quote works and the run is off. Start with npm run demo to see sample data.</p>}
      {reply && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-12">
            <thead className="text-mute"><tr><th className="py-1 pr-3 font-medium">Call</th><th className="py-1 pr-3 font-medium">Provider</th><th className="py-1 pr-3 font-medium">looot job</th><th className="py-1 pr-3 text-right font-medium">Price</th><th className="py-1 pr-3 text-right font-medium">Calls</th><th className="py-1 text-right font-medium">Total</th></tr></thead>
            <tbody>
              {reply.quote.lines.map((l) => (
                <tr key={l.kind} className="border-t border-line">
                  <td className="py-1 pr-3">{l.label}</td><td className="py-1 pr-3 text-mute">{l.provider}</td><td className="num py-1 pr-3 text-mute">{l.jobId}</td>
                  <td className="num py-1 pr-3 text-right">{usdPrecise(l.priceMicros)}</td><td className="num py-1 pr-3 text-right">{l.calls}</td><td className="num py-1 text-right">{usdPrecise(l.totalMicros)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-13">
            <strong className="num">{usd(total)}</strong> for {reply.leads} leads at list price, {reply.leads ? usdPrecise(Math.round(total / reply.leads)) : "$0"} each. Company and tech calls are paid once per domain. Prices {reply.quote.priceSource === "catalog" ? "read from the public catalog" : "from the dated fallback"}.
            {demo && " Demo mode charges nothing."}
            {overCap && <span className="ml-2 text-high">Above your {usd(capNum * 1_000_000)} cap. Raise the cap or remove leads.</span>}
            {!fresh && <span className="ml-2 text-amber">The CSV changed. Get a new quote.</span>}
          </p>
          {reply.rejected.length > 0 && <p className="text-12 text-mute">Skipped {reply.rejected.length} rows: {reply.rejected.slice(0, 3).join("; ")}</p>}
          {reply.unpriced.length > 0 && <p className="text-12 text-high">Live price unreadable for {reply.unpriced.join(", ")}. Those calls will be skipped.</p>}
        </div>
      )}
    </section>
  );
}

import fs from "node:fs";
import path from "node:path";
import { DEMO_NOW, demoCsv, demoRunner } from "@/engine/demo";
import { buildQuote, runEnrichment } from "@/engine/engine";
import { loadIcp, parseIcp, saveIcp, type Icp } from "@/engine/icp";
import { parseLeads } from "@/engine/leads";
import { fetchPrices, hasLoootToken, loootFromEnv } from "@/engine/looot";
import { toMicros } from "@/engine/money";
import { FALLBACK_PRICES } from "@/engine/providers";
import { scoreAll } from "@/engine/score";
import { readState, writeState, type State } from "@/engine/state";
import type { LeadScore, Quote } from "@/engine/types";

/** true when the app runs on sample data: no token, no network, no cost. */
export function isDemo(): boolean {
  return process.env.LOOOT_SCORE_DEMO === "1";
}

export function canRunLive(): boolean {
  return hasLoootToken();
}

declare global {
  var __scoreDemoState: State | undefined;
}

const icpFile = () => path.resolve(/*turbopackIgnore: true*/ process.env.LOOOT_SCORE_ICP ?? "config/icp.json");

/** The ICP in force: the one saved from the editor, else the config file. */
export async function getIcp(): Promise<Icp> {
  if (isDemo()) return globalThis.__scoreDemoState?.icp ?? loadIcp(icpFile());
  return loadIcp(icpFile());
}

/** Saves an edited ICP. Live mode writes the config file, so the CLI uses it too. Demo mode keeps it in memory. */
export async function setIcp(raw: unknown): Promise<Icp> {
  const icp = parseIcp(raw);
  if (isDemo()) {
    const st = await getState();
    globalThis.__scoreDemoState = { run: st.run, icp };
  } else saveIcp(icp, icpFile());
  return icp;
}

/** The latest enrichment. In demo mode it is computed once from the sample leads and kept in memory. */
export async function getState(): Promise<State> {
  if (!isDemo()) return readState();
  if (!globalThis.__scoreDemoState?.run) {
    const icp = globalThis.__scoreDemoState?.icp ?? loadIcp(icpFile());
    const { leads } = parseLeads(demoCsv());
    const run = await runEnrichment({ icp, leads, looot: demoRunner(), prices: FALLBACK_PRICES, capMicros: 5_000_000, now: DEMO_NOW, demo: true });
    globalThis.__scoreDemoState = { run, icp: globalThis.__scoreDemoState?.icp ?? null };
  }
  return globalThis.__scoreDemoState;
}

/** Scores for the latest run under the ICP in force. Cheap: no call is made. */
export async function getScores(): Promise<{ scores: LeadScore[]; icp: Icp; state: State }> {
  const [icp, state] = await Promise.all([getIcp(), getState()]);
  return { scores: state.run ? scoreAll(state.run.profiles, icp) : [], icp, state };
}

export interface QuoteReply {
  quote: Quote;
  rejected: string[];
  leads: number;
  unpriced: string[];
}

/** Quote for a CSV. Reads prices from the public catalog (free) unless in demo mode. */
export async function quoteFor(csv: string): Promise<QuoteReply> {
  const { leads, rejected } = parseLeads(csv);
  const icp = await getIcp();
  if (isDemo()) return { quote: buildQuote(leads, icp, FALLBACK_PRICES, "catalog"), rejected, leads: leads.length, unpriced: [] };
  const live = await fetchPrices(FALLBACK_PRICES);
  return { quote: buildQuote(leads, icp, live.prices, live.source), rejected, leads: leads.length, unpriced: live.unread };
}

/** Enriches the leads for the UI and saves the result. The UI never sees the token. */
export async function runFor(input: { csv: string; capUsd: number }): Promise<{ runId: string; spentMicros: number; leads: number }> {
  const { leads, rejected } = parseLeads(input.csv);
  if (leads.length === 0) throw new Error("No usable leads in the CSV.");
  if (leads.length > 2000) throw new Error("At most 2,000 leads per run.");
  const icp = await getIcp();
  const capMicros = toMicros(input.capUsd);
  if (isDemo()) {
    const run = await runEnrichment({ icp, leads, rejected, looot: demoRunner(), prices: FALLBACK_PRICES, capMicros, now: DEMO_NOW, demo: true });
    globalThis.__scoreDemoState = { run, icp: globalThis.__scoreDemoState?.icp ?? null };
    return { runId: run.runId, spentMicros: 0, leads: leads.length };
  }
  const looot = loootFromEnv();
  const live = await fetchPrices(FALLBACK_PRICES);
  const quote = buildQuote(leads, icp, live.prices, live.source);
  if (quote.totalMicros > capMicros) throw new Error(`The quote ($${(quote.totalMicros / 1e6).toFixed(2)}) is above the cap ($${input.capUsd.toFixed(2)}). Raise the cap or score fewer leads.`);
  const run = await runEnrichment({ icp, leads, rejected, looot, prices: live.prices, priceSource: live.source, unpriced: live.unread, capMicros });
  writeState({ run, icp: null });
  return { runId: run.runId, spentMicros: run.spentMicros, leads: leads.length };
}

/** The sample CSV, for the demo's input box. */
export function sampleCsv(): string {
  if (isDemo()) return demoCsv();
  try {
    return fs.readFileSync(path.resolve(/*turbopackIgnore: true*/ "data/sample-leads.csv"), "utf8");
  } catch {
    return "";
  }
}

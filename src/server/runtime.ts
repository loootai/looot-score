import fs from "node:fs";
import path from "node:path";
import { Budget, type BudgetStatus } from "@/engine/budget";
import { DEMO_NOW, demoCsv, demoRunner } from "@/engine/demo";
import { buildQuote, runEnrichment } from "@/engine/engine";
import { loadIcp, parseIcp, saveIcp, type Icp } from "@/engine/icp";
import { parseLeads } from "@/engine/leads";
import { fetchPrices, hasLoootToken, loootFromEnv } from "@/engine/looot";
import { toMicros, usd } from "@/engine/money";
import { FALLBACK_PRICES } from "@/engine/providers";
import { scoreAll } from "@/engine/score";
import { readState, writeState, type State } from "@/engine/state";
import type { LeadScore, Quote } from "@/engine/types";
import { allow, retryAfter } from "@/lib/auth/limits";

/** true when the app runs on sample data: no token, no network, no cost. */
export function isDemo(): boolean {
  return process.env.LOOOT_SCORE_DEMO === "1";
}

/** Spend cap per run in dollars. Set by the server in LOOOT_SCORE_CAP_USD, default 5. The browser cannot change it. */
export function serverCapUsd(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.LOOOT_SCORE_CAP_USD);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

/** The period budget file. Demo mode only reads it, so a demo shows the owner's real numbers and writes nothing. */
export function getBudget(): Budget {
  return new Budget();
}

/** Used, reserved and remaining for today and this month. */
export async function budgetStatus(now: Date = new Date()): Promise<BudgetStatus> {
  return getBudget().status(now);
}

/** Owner only (the route checks the session and the CSRF token). Saves the daily and monthly budget in dollars. */
export async function setBudget(input: { dailyUsd: unknown; monthlyUsd: unknown }): Promise<BudgetStatus> {
  if (isDemo()) throw new Error("Demo mode has no budget to change.");
  const b = getBudget();
  await b.setLimits({ dailyMicros: toMicros(Number(input.dailyUsd)), monthlyMicros: toMicros(Number(input.monthlyUsd)) });
  return b.status();
}

/** Runs one session may start in a window. */
export const RUNS_PER_WINDOW = 6;
export const RUN_WINDOW_MS = 10 * 60_000;

export class RunLimitError extends Error {}

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
  /** The server's cap per run in dollars, so the screen can show it. */
  capUsd: number;
  quote: Quote;
  rejected: string[];
  leads: number;
  unpriced: string[];
}

/** Quote for a CSV. Reads prices from the public catalog (free) unless in demo mode. */
export async function quoteFor(csv: string): Promise<QuoteReply> {
  const { leads, rejected } = parseLeads(csv);
  const icp = await getIcp();
  if (isDemo()) return { capUsd: serverCapUsd(), quote: buildQuote(leads, icp, FALLBACK_PRICES, "catalog"), rejected, leads: leads.length, unpriced: [] };
  const live = await fetchPrices(FALLBACK_PRICES);
  return { capUsd: serverCapUsd(), quote: buildQuote(leads, icp, live.prices, live.source), rejected, leads: leads.length, unpriced: live.unread };
}

/**
 * Enriches the leads for the UI and saves the result. The UI never sees the token.
 * The cap is the server's, the quote is checked against it, and a session may start `RUNS_PER_WINDOW` runs per window.
 */
export async function runFor(input: { csv: string; sid?: string }): Promise<{ runId: string; spentMicros: number; leads: number; budgetMessage?: string | null }> {
  const { leads, rejected } = parseLeads(input.csv);
  if (leads.length === 0) throw new Error("No usable leads in the CSV.");
  if (leads.length > 2000) throw new Error("At most 2,000 leads per run.");
  const icp = await getIcp();
  const capUsd = serverCapUsd();
  const capMicros = toMicros(capUsd);
  const limitKey = `run:${input.sid ?? "demo"}`;
  if (!allow(limitKey, RUNS_PER_WINDOW, RUN_WINDOW_MS)) throw new RunLimitError(`Too many runs from this session. Try again in ${retryAfter(limitKey)} seconds.`);
  if (isDemo()) {
    const run = await runEnrichment({ icp, leads, rejected, looot: demoRunner(), prices: FALLBACK_PRICES, capMicros, now: DEMO_NOW, demo: true });
    globalThis.__scoreDemoState = { run, icp: globalThis.__scoreDemoState?.icp ?? null };
    return { runId: run.runId, spentMicros: 0, leads: leads.length };
  }
  const looot = loootFromEnv();
  const live = await fetchPrices(FALLBACK_PRICES);
  const quote = buildQuote(leads, icp, live.prices, live.source);
  if (quote.totalMicros > capMicros) throw new Error(`The quote ($${(quote.totalMicros / 1e6).toFixed(2)}) is above the cap ($${capUsd.toFixed(2)}). Score fewer leads, or raise LOOOT_SCORE_CAP_USD on the server.`);
  // Check order: quote, per-run cap (above), period budget, then the calls. Runs that ended since last time settle first.
  const budget = getBudget();
  await budget.reconcile(looot);
  const room = await budget.status();
  if (quote.totalMicros > room.remainingMicros) throw new Error(`The quote (${usd(quote.totalMicros)}) is above what is left of the budget (${usd(room.remainingMicros)}: ${usd(room.day.remainingMicros)} today, ${usd(room.month.remainingMicros)} this month). Raise the budget on the Costs page, or wait for the period to roll over.`);
  const run = await runEnrichment({ icp, leads, rejected, looot, prices: live.prices, priceSource: live.source, unpriced: live.unread, capMicros, ledger: budget });
  writeState({ run, icp: null });
  return { runId: run.runId, spentMicros: run.spentMicros, leads: leads.length, budgetMessage: run.budgetMessage };
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

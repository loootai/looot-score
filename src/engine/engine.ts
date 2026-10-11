import { createHash } from "node:crypto";
import type { Ledger } from "./budget";
import type { Icp } from "./icp";
import { emailDomain, PERSONAL_EMAIL_DOMAINS } from "./leads";
import { LoootError, type PriceMap, type Runner } from "./looot";
import { toMicros } from "./money";
import { PROVIDERS, inputFor, type Facts } from "./providers";
import type { CallKind, CallRecord, CompanyFacts, EnrichRun, Lead, Profile, Quote, QuoteLine } from "./types";

/** The calls one lead needs, as keys. Leads of the same company share the company and tech keys. */
interface Need {
  kind: CallKind;
  key: string;
  input: Record<string, unknown>;
}

/** true when the ICP scores tech at all. Without it the tech call is not made or quoted. */
export function needsTech(icp: Icp): boolean {
  const t = icp.components.tech;
  return t.points > 0 && (t.include.length > 0 || t.exclude.length > 0);
}

/** The company domain of a lead: the CSV domain, else a work email's domain. */
export function companyDomainOf(lead: Lead): string | undefined {
  if (lead.domain) return lead.domain;
  const d = emailDomain(lead.email);
  return d && !PERSONAL_EMAIL_DOMAINS.has(d) ? d : undefined;
}

/** What one lead needs from looot, in a fixed order. */
export function needsOf(lead: Lead, icp: Icp): Need[] {
  const out: Need[] = [];
  const domain = companyDomainOf(lead);
  if (lead.email) out.push({ kind: "person_by_email", key: `person:${lead.email}`, input: inputFor("person_by_email", { email: lead.email }) });
  else if (lead.firstName && lead.lastName && domain) out.push({ kind: "person_by_name", key: `name:${lead.firstName} ${lead.lastName}@${domain}`.toLowerCase(), input: inputFor("person_by_name", { firstName: lead.firstName, lastName: lead.lastName, domain }) });
  if (domain) {
    out.push({ kind: "company", key: `company:${domain}`, input: inputFor("company", { domain }) });
    if (needsTech(icp)) out.push({ kind: "tech", key: `tech:${domain}`, input: inputFor("tech", { domain }) });
  }
  return out;
}

/** What a run costs at list price. Pure: no call is made. Company and tech calls are counted once per domain. */
export function buildQuote(leads: Lead[], icp: Icp, prices: PriceMap, priceSource: Quote["priceSource"] = "catalog"): Quote {
  const keys = new Map<string, CallKind>();
  for (const l of leads) for (const n of needsOf(l, icp)) keys.set(n.key, n.kind);
  const count: Record<CallKind, number> = { person_by_email: 0, person_by_name: 0, company: 0, tech: 0 };
  for (const k of keys.values()) count[k] += 1;
  const lines: QuoteLine[] = (Object.keys(count) as CallKind[])
    .filter((k) => count[k] > 0)
    .map((k) => {
      const d = PROVIDERS[k];
      const priceMicros = prices[d.endpointId] ?? d.fallbackMicros;
      return { kind: k, label: d.label, provider: d.provider, jobId: d.jobId, endpointId: d.endpointId, calls: count[k], priceMicros, totalMicros: priceMicros * count[k] };
    });
  return { lines, leads: leads.length, totalMicros: lines.reduce((n, l) => n + l.totalMicros, 0), priceSource };
}

function windowStamp(now: Date, w: Icp["freshnessWindow"]): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (w === "month") return d.toISOString().slice(0, 7);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function shortHash(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0").slice(0, 12);
}

/** One key per (call kind, input, window). The same key replays the stored run and never charges twice. */
export function idempotencyKey(kind: CallKind, input: Record<string, unknown>, icp: Icp, now: Date): string {
  return `score:v1:${kind}:${shortHash(JSON.stringify(input))}:${windowStamp(now, icp.freshnessWindow)}`;
}

/** Hash of what a paid call asks for: endpoint and input, with sorted keys and lowercased text. Guards a short key against a collision. */
export function callFingerprint(endpointId: string, input: Record<string, unknown>): string {
  const norm = (v: unknown): unknown => (typeof v === "string" ? v.trim().toLowerCase() : Array.isArray(v) ? v.map(norm) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, norm(x)])) : v);
  return createHash("sha256").update(JSON.stringify([endpointId, norm(input)])).digest("hex");
}

export interface RunOptions {
  leads: Lead[];
  rejected?: string[];
  icp: Icp;
  looot: Runner;
  prices: PriceMap;
  priceSource?: Quote["priceSource"];
  unpriced?: readonly string[];
  capMicros: number;
  /** Period budget, reservations and stored answers. Left out in demo mode and in tests that do not need it. */
  ledger?: Ledger;
  now?: Date;
  demo?: boolean;
  onProgress?: (done: number, total: number) => void;
}

const FAIL_STOPS = new Set(["unauthorized", "insufficient_funds", "payment_required", "invalid_token", "missing_token"]);

function mergeCompany(base: CompanyFacts, add: Facts["company"], provider: string): void {
  if (!add) return;
  if (base.industry === undefined && add.industry) {
    base.industry = add.industry;
    base.from.industry = provider;
  }
  if (base.employees === undefined && add.employees !== undefined) {
    base.employees = add.employees;
    base.from.employees = provider;
  }
  if (base.country === undefined && add.country) {
    base.country = add.country;
    base.from.country = provider;
  }
  if (base.technologies === undefined && add.technologies) {
    base.technologies = add.technologies;
    base.from.technologies = provider;
  }
}

/**
 * Enriches every lead through looot and returns what came back. Scoring is separate (scoreAll), so a new ICP
 * re-scores without a call. Before each call the list price is reserved against the cap. A call still running
 * when waiting stops is "pending", never a failure.
 */
export async function runEnrichment(opts: RunOptions): Promise<EnrichRun> {
  const { icp, looot, prices } = opts;
  const now = opts.now ?? new Date();
  const startedAt = opts.demo ? now.toISOString() : new Date().toISOString();
  const quote = buildQuote(opts.leads, icp, prices, opts.priceSource);
  const unpriced = new Set(opts.unpriced ?? []);
  let committed = 0;
  let spent = 0;
  let skippedByCap = 0;
  let skippedByBudget = 0;
  let budgetMessage: string | null = null;
  let pendingCalls = 0;
  let failedCalls = 0;
  let aborted: string | null = null;

  type Done = { rec: CallRecord; facts: Facts };
  const memo = new Map<string, Promise<Done>>();

  async function execute(need: Need): Promise<Done> {
    const def = PROVIDERS[need.kind];
    const listPriceMicros = prices[def.endpointId] ?? def.fallbackMicros;
    const base = { kind: need.kind, provider: def.provider, endpointId: def.endpointId, listPriceMicros, costMicros: 0, shared: false };
    if (aborted) return { rec: { ...base, status: "skipped_cap", message: aborted }, facts: {} };
    if (!opts.demo && unpriced.has(def.endpointId)) return { rec: { ...base, status: "skipped_price", message: "Live price could not be read." }, facts: {} };
    if (!opts.demo && committed + listPriceMicros > opts.capMicros) {
      skippedByCap += 1;
      return { rec: { ...base, status: "skipped_cap", message: "Spend cap reached." }, facts: {} };
    }
    const ledger = opts.demo ? undefined : opts.ledger;
    const key = idempotencyKey(need.kind, need.input, icp, now);
    const fp = callFingerprint(def.endpointId, need.input);
    if (ledger) {
      const stored = await ledger.recall(key, fp, now);
      if (stored) {
        try {
          return { rec: { ...base, status: "ok", runId: stored.runId, message: "Answered from the stored result. No call, no charge." }, facts: def.parse(stored.result) };
        } catch {
          // A stored result that no longer parses is called again; the same key replays it at looot with no second charge.
        }
      }
      const held = await ledger.reserve(key, listPriceMicros, now, fp);
      if (!held.ok) {
        skippedByBudget += 1;
        budgetMessage = held.message;
        return { rec: { ...base, status: "skipped_budget", message: held.message }, facts: {} };
      }
    }
    if (!opts.demo) committed += listPriceMicros;
    try {
      const run = await looot.runAndWait(def.endpointId, need.input, key);
      const cost = opts.demo ? 0 : toMicros(run.actualCost);
      if (run.status === "completed") {
        committed += cost - listPriceMicros;
        spent += cost;
        await ledger?.settle(key, fp, cost, now, run);
        try {
          return { rec: { ...base, status: "ok", costMicros: cost, runId: run.runId }, facts: def.parse(run.result) };
        } catch (e) {
          failedCalls += 1;
          return { rec: { ...base, status: "parse_error", costMicros: cost, runId: run.runId, message: (e as Error).message }, facts: {} };
        }
      }
      if (run.status === "failed" || run.status === "blocked" || run.status === "stopped") {
        committed += cost - listPriceMicros;
        spent += cost;
        failedCalls += 1;
        await ledger?.settle(key, fp, cost, now);
        return { rec: { ...base, status: "failed", costMicros: cost, runId: run.runId, errorCode: run.error?.code ?? run.status, message: run.error?.message }, facts: {} };
      }
      // Still running at looot: the reservation stays until the run ends. It is never recorded failed at zero.
      pendingCalls += 1;
      await ledger?.attach(key, run.runId);
      return { rec: { ...base, status: "pending", runId: run.runId, message: `Run ${run.runId} is ${run.status}.` }, facts: {} };
    } catch (e) {
      committed -= listPriceMicros;
      failedCalls += 1;
      const err = e instanceof LoootError ? e : null;
      // An HTTP answer from looot means the call did not run, so the reservation goes back. A network error is unknown:
      // the request may have been accepted, so the reservation stays until the hard expiry or a replay settles it.
      if (err) await ledger?.release(key);
      if (err && (FAIL_STOPS.has(err.code ?? "") || err.status === 401 || err.status === 402)) aborted = `Stopped: ${err.message}`;
      return { rec: { ...base, status: "failed", errorCode: err?.code ?? "network_error", message: (e as Error).message }, facts: {} };
    }
  }

  const profiles: Profile[] = new Array(opts.leads.length);
  let next = 0;
  let done = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= opts.leads.length) return;
      const lead = opts.leads[i];
      const profile: Profile = { lead, person: {}, company: { from: {} }, calls: [], costMicros: 0 };
      const results: { need: Need; done: Done; owner: boolean }[] = [];
      for (const need of needsOf(lead, icp)) {
        let owner = false;
        let p = memo.get(need.key);
        if (!p) {
          owner = true;
          p = execute(need);
          memo.set(need.key, p);
        }
        results.push({ need, done: await p, owner });
      }
      // Company facts: the company call wins, then the person call's company block, then tech.
      const order: CallKind[] = ["company", "person_by_email", "person_by_name", "tech"];
      for (const kind of order) {
        for (const r of results.filter((x) => x.need.kind === kind)) {
          const rec = { ...r.done.rec, shared: !r.owner, costMicros: r.owner ? r.done.rec.costMicros : 0 };
          profile.calls.push(rec);
          profile.costMicros += rec.costMicros;
          if (rec.status === "ok") {
            if (r.done.facts.person && Object.keys(r.done.facts.person).length && !profile.person.title && !profile.person.seniority) profile.person = r.done.facts.person;
            mergeCompany(profile.company, r.done.facts.company, rec.provider);
          }
        }
      }
      profiles[i] = profile;
      opts.onProgress?.(++done, opts.leads.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(icp.concurrency, Math.max(1, opts.leads.length)) }, worker));

  return {
    runId: `run_${shortHash(startedAt + opts.leads.map((l) => l.id).join(","))}`,
    startedAt,
    finishedAt: opts.demo ? now.toISOString() : new Date().toISOString(),
    demo: opts.demo ?? false,
    capMicros: opts.capMicros,
    quotedMicros: quote.totalMicros,
    spentMicros: spent,
    skippedByCap,
    skippedByBudget,
    budgetMessage,
    pendingCalls,
    failedCalls,
    aborted,
    quote,
    profiles,
    rejected: opts.rejected ?? [],
  };
}

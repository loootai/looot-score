import { describe, expect, it } from "vitest";
import { DEMO_NOW, demoCsv, demoRunner } from "./demo";
import { buildQuote, idempotencyKey, needsOf, needsTech, runEnrichment } from "./engine";
import { loadIcp } from "./icp";
import { parseLeads } from "./leads";
import { LoootError, type LoootRun, type Runner } from "./looot";
import { FALLBACK_PRICES } from "./providers";
import { scoreAll } from "./score";

const icp = loadIcp();
const now = new Date("2026-10-10T09:00:00Z");
const base = { icp, prices: FALLBACK_PRICES, now };
const leadsOf = (csv: string) => parseLeads(csv).leads;
const done = (cost: number, result: unknown = {}): LoootRun => ({ runId: "r", status: "completed", result, actualCost: cost });

function recorder(answer: (endpointId: string) => LoootRun | Promise<LoootRun>) {
  const calls: { endpointId: string; input: Record<string, unknown>; key: string }[] = [];
  const looot: Runner = {
    async runAndWait(endpointId, input, key) {
      calls.push({ endpointId, input, key });
      return answer(endpointId);
    },
  };
  return { looot, calls };
}

const CSV = "email\na@acme.example\nb@acme.example\nc@globex.example\n";

describe("needs and quote", () => {
  it("plans one person call per lead and one company and tech call per domain", () => {
    const leads = leadsOf(CSV);
    expect(needsOf(leads[0], icp).map((n) => n.kind)).toEqual(["person_by_email", "company", "tech"]);
    const q = buildQuote(leads, icp, FALLBACK_PRICES);
    const calls = Object.fromEntries(q.lines.map((l) => [l.kind, l.calls]));
    expect(calls).toEqual({ person_by_email: 3, company: 2, tech: 2 });
    expect(q.totalMicros).toBe(3 * 4_830 + 2 * 1_900 + 2 * 10_000);
  });
  it("uses a name lead's person-by-name call and skips a personal mailbox's company calls", () => {
    const leads = leadsOf("email,first_name,last_name,domain\n,Ada,Lovelace,acme.com\nme@gmail.com,,,\n");
    expect(needsOf(leads[0], icp).map((n) => n.kind)).toEqual(["person_by_name", "company", "tech"]);
    expect(needsOf(leads[1], icp).map((n) => n.kind)).toEqual(["person_by_email"]);
  });
  it("leaves the tech call out when the ICP does not score tech", () => {
    const noTech = structuredClone(icp);
    noTech.components.tech.include = [];
    expect(needsTech(noTech)).toBe(false);
    expect(buildQuote(leadsOf(CSV), noTech, FALLBACK_PRICES).lines.map((l) => l.kind)).not.toContain("tech");
  });
  it("makes no call to quote", () => {
    const { calls } = recorder(() => done(0));
    buildQuote(leadsOf(CSV), icp, FALLBACK_PRICES);
    expect(calls).toHaveLength(0);
  });
});

describe("runEnrichment", () => {
  it("pays for a shared company call once and attributes the cost to one lead", async () => {
    const { looot, calls } = recorder(() => done(0.01));
    const run = await runEnrichment({ ...base, leads: leadsOf(CSV), looot, capMicros: 5_000_000 });
    expect(calls.filter((c) => c.endpointId === "thecompaniesapi-companies-by-email")).toHaveLength(2);
    expect(calls).toHaveLength(3 + 2 + 2);
    expect(run.spentMicros).toBe(7 * 10_000);
    expect(run.profiles.reduce((n, p) => n + p.costMicros, 0)).toBe(run.spentMicros);
    const sharedFlags = run.profiles[1].calls.filter((c) => c.shared);
    expect(sharedFlags.map((c) => c.kind).sort()).toEqual(["company", "tech"]);
    expect(sharedFlags.every((c) => c.costMicros === 0)).toBe(true);
  });
  it("sends a stable key per call that changes with the input and the window", async () => {
    const { looot, calls } = recorder(() => done(0));
    await runEnrichment({ ...base, leads: leadsOf(CSV), looot, capMicros: 5_000_000 });
    expect(new Set(calls.map((c) => c.key)).size).toBe(calls.length);
    const k = idempotencyKey("company", { email: "info@acme.example" }, icp, now);
    expect(idempotencyKey("company", { email: "info@acme.example" }, icp, new Date("2026-10-28T00:00:00Z"))).toBe(k); // same month
    expect(idempotencyKey("company", { email: "info@acme.example" }, icp, new Date("2026-11-01T00:00:00Z"))).not.toBe(k);
    expect(idempotencyKey("company", { email: "info@globex.example" }, icp, now)).not.toBe(k);
  });
  it("never makes a call that could pass the cap", async () => {
    const { looot, calls } = recorder((id) => done(FALLBACK_PRICES[id] / 1e6));
    const cap = 30_000;
    const run = await runEnrichment({ ...base, leads: leadsOf(CSV), looot, capMicros: cap, icp: { ...icp, concurrency: 3 } });
    expect(calls.reduce((n, c) => n + (FALLBACK_PRICES[c.endpointId] ?? 0), 0)).toBeLessThanOrEqual(cap);
    expect(run.spentMicros).toBeLessThanOrEqual(cap);
    expect(run.skippedByCap).toBe(7 - calls.length);
    expect(run.skippedByCap).toBeGreaterThan(0);
  });
  it("makes no call with a zero cap and still returns scoreable, empty profiles", async () => {
    const { looot, calls } = recorder(() => done(0));
    const run = await runEnrichment({ ...base, leads: leadsOf(CSV), looot, capMicros: 0 });
    expect(calls).toHaveLength(0);
    expect(scoreAll(run.profiles, icp).every((s) => s.coverage.known === 0)).toBe(true);
  });
  it("refuses an endpoint whose price could not be read", async () => {
    const { looot, calls } = recorder(() => done(0));
    const run = await runEnrichment({ ...base, leads: leadsOf(CSV), looot, capMicros: 5_000_000, unpriced: ["predictleads-companies-technology-detections"] });
    expect(calls.map((c) => c.endpointId)).not.toContain("predictleads-companies-technology-detections");
    expect(run.profiles[0].calls.find((c) => c.kind === "tech")!.status).toBe("skipped_price");
  });
  it("treats a run still in progress as pending, not failed", async () => {
    const { looot } = recorder((id) => (id.startsWith("quickenrich") ? { runId: "r1", status: "pending_provider" } : done(0)));
    const run = await runEnrichment({ ...base, leads: leadsOf("email\na@acme.example\n"), looot, capMicros: 5_000_000 });
    expect(run.pendingCalls).toBe(1);
    expect(run.failedCalls).toBe(0);
    expect(scoreAll(run.profiles, icp)[0].pending).toBe(true);
  });
  it("records a failed call and carries on", async () => {
    const { looot } = recorder((id) => (id.startsWith("thecompaniesapi") ? { runId: "r", status: "failed", actualCost: 0, error: { code: "upstream_error" } } : done(0.01)));
    const run = await runEnrichment({ ...base, leads: leadsOf("email\na@acme.example\n"), looot, capMicros: 5_000_000 });
    expect(run.failedCalls).toBe(1);
    expect(run.spentMicros).toBe(2 * 10_000);
  });
  it("stops the whole run on a 402", async () => {
    const { looot, calls } = recorder(() => {
      throw new LoootError("Top up to continue", 402, "insufficient_funds");
    });
    const run = await runEnrichment({ ...base, leads: leadsOf(CSV), looot, capMicros: 5_000_000, icp: { ...icp, concurrency: 1 } });
    expect(calls).toHaveLength(1);
    expect(run.aborted).toContain("Top up");
  });
  it("fills a company fact from the person call when the company call gave none", async () => {
    const { looot } = recorder((id) => (id.startsWith("quickenrich") ? done(0, { data: { person: { job_title: "CEO" }, company: { industry: "Software", employees: 90 } } }) : done(0, {})));
    const run = await runEnrichment({ ...base, leads: leadsOf("email\na@acme.example\n"), looot, capMicros: 5_000_000 });
    expect(run.profiles[0].company).toMatchObject({ industry: "Software", employees: 90, from: { industry: "quickenrich" } });
  });
});

describe("demo", () => {
  it("scores the sample leads with a spread of grades at zero cost", async () => {
    const { leads } = parseLeads(demoCsv());
    const run = await runEnrichment({ ...base, now: DEMO_NOW, leads, looot: demoRunner(), capMicros: 5_000_000, demo: true });
    const scores = scoreAll(run.profiles, icp);
    expect(run.spentMicros).toBe(0);
    expect(new Set(scores.map((s) => s.grade)).size).toBe(4);
    expect(scores.find((s) => s.lead.email === "someone.private@gmail.com")!.grade).toBe("D");
  });
});

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Budget, DEFAULT_LIMITS, HARD_EXPIRY_MS, RESERVE_TTL_MS } from "./budget";
import { DEMO_NOW } from "./demo";
import { runEnrichment } from "./engine";
import { loadIcp } from "./icp";
import { parseLeads } from "./leads";
import { LoootError, type LoootRun, type Runner } from "./looot";
import { FALLBACK_PRICES } from "./providers";

const icp = loadIcp();
const now = new Date("2026-10-10T09:00:00Z");
const CSV = "email\na@acme.example\nb@acme.example\nc@globex.example\n";
const leads = parseLeads(CSV).leads;
const base = { icp, prices: FALLBACK_PRICES, now, capMicros: 5_000_000 };
let dir: string;
let file: string;
const open = () => new Budget(file);

beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  dir = mkdtempSync(join(process.cwd(), ".vitest", "budget-"));
  file = join(dir, "budget.json");
});

function runner(answer: (n: number, endpointId: string) => LoootRun | Promise<LoootRun> | never) {
  const calls: string[] = [];
  const looot: Runner = {
    async runAndWait(endpointId) {
      calls.push(endpointId);
      return answer(calls.length, endpointId);
    },
  };
  return { looot, calls };
}
const completed = (cost: number): LoootRun => ({ runId: "run_ok", status: "completed", result: {}, actualCost: cost });

describe("period budget", () => {
  it("has a default daily and monthly limit that the owner can change", async () => {
    const b = open();
    expect((await b.status(now)).limits).toEqual(DEFAULT_LIMITS);
    await b.setLimits({ dailyMicros: 2_000_000, monthlyMicros: 9_000_000 });
    expect((await open().status(now)).limits).toEqual({ dailyMicros: 2_000_000, monthlyMicros: 9_000_000 });
  });

  it("lets exactly one of two concurrent reservations through when their sum is over the budget", async () => {
    await open().setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    const out = await Promise.all([open().reserve("k1", 700_000, now), open().reserve("k2", 700_000, now)]);
    expect(out.filter((r) => r.ok)).toHaveLength(1);
    expect(out.filter((r) => !r.ok)).toHaveLength(1);
    expect((await open().status(now)).day.reservedMicros).toBe(700_000);
  });

  it("holds under 25 concurrent reservations from separate handles", async () => {
    await open().setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    const out = await Promise.all(Array.from({ length: 25 }, (_, i) => open().reserve(`k${i}`, 100_000, now)));
    expect(out.filter((r) => r.ok)).toHaveLength(10);
    const s = await open().status(now);
    expect(s.day.reservedMicros).toBe(1_000_000);
    expect(s.day.remainingMicros).toBe(0);
  });

  it("stops many small runs at the budget and says which limit it hit", async () => {
    await open().setLimits({ dailyMicros: 300_000, monthlyMicros: 300_000 });
    const b = open();
    let ok = 0;
    let last = "";
    for (let i = 0; i < 10; i++) {
      const r = await b.reserve(`s${i}`, 100_000, now);
      if (r.ok) ok++;
      else last = r.message;
    }
    expect(ok).toBe(3);
    expect(last).toMatch(/budget is reached/i);
  });

  it("counts a settled run against the day and the month, and a new day starts clean", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    await b.reserve("a", 400_000, now);
    await b.settle("a", "fp", 350_000, now);
    const s = await b.status(now);
    expect(s.day.usedMicros).toBe(350_000);
    expect(s.month.usedMicros).toBe(350_000);
    const next = new Date("2026-10-11T09:00:00Z");
    const s2 = await b.status(next);
    expect(s2.day.usedMicros).toBe(0);
    expect(s2.month.usedMicros).toBe(350_000);
  });

  it("releases a reservation", async () => {
    const b = open();
    await b.reserve("a", 400_000, now);
    await b.release("a");
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("rejects limits that are not positive or put the day above the month", async () => {
    const b = open();
    await expect(b.setLimits({ dailyMicros: 0, monthlyMicros: 1_000_000 })).rejects.toThrow();
    await expect(b.setLimits({ dailyMicros: 5_000_000, monthlyMicros: 1_000_000 })).rejects.toThrow(/daily/i);
    await expect(b.setLimits({ dailyMicros: Number.NaN, monthlyMicros: 1_000_000 })).rejects.toThrow();
  });
});

describe("reconciling reservations", () => {
  async function pendingReservation() {
    const b = open();
    await b.reserve("p", 10_000, now);
    await b.attach("p", "run_p");
    return b;
  }

  it("settles a late completion to the real cost", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "completed", result: { x: 1 }, actualCost: 0.0031 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(3_100);
  });

  it("keeps the reservation while the run is still going", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "running" }) }, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(10_000);
    expect(s.day.usedMicros).toBe(0);
  });

  it("releases when the run ended failed with no charge", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "failed", actualCost: 0 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(0);
  });

  it("keeps an unfetchable run reserved until the hard expiry, then releases it", async () => {
    const b = await pendingReservation();
    const broken = { getRun: async (): Promise<LoootRun> => { throw new LoootError("down", 503); } };
    await b.reconcile(broken, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    expect((await b.status(now)).day.reservedMicros).toBe(10_000);
    await b.reconcile(broken, new Date(now.getTime() + HARD_EXPIRY_MS + 1));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("keeps a reservation that never got a run id until the hard expiry", async () => {
    const b = open();
    await b.reserve("crash", 10_000, now);
    await b.reconcile({ getRun: async () => { throw new Error("not called"); } }, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    expect((await b.status(now)).day.reservedMicros).toBe(10_000);
    await b.reconcile({ getRun: async () => { throw new Error("not called"); } }, new Date(now.getTime() + HARD_EXPIRY_MS + 1));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });
});

describe("runEnrichment with the budget", () => {
  it("does not charge a repeated identical request twice", async () => {
    const b = open();
    const first = runner(() => completed(0.005));
    const r1 = await runEnrichment({ ...base, leads, looot: first.looot, ledger: b });
    const second = runner(() => completed(0.005));
    const r2 = await runEnrichment({ ...base, leads, looot: second.looot, ledger: b });
    expect(first.calls.length).toBeGreaterThan(0);
    expect(second.calls).toHaveLength(0);
    expect(r2.spentMicros).toBe(0);
    expect((await b.status(now)).day.usedMicros).toBe(r1.spentMicros);
  });

  it("answers two identical requests started together with one charge", async () => {
    const b = open();
    const a = runner(async () => { await new Promise((r) => setTimeout(r, 20)); return completed(0.005); });
    const c = runner(async () => { await new Promise((r) => setTimeout(r, 20)); return completed(0.005); });
    const [r1] = await Promise.all([runEnrichment({ ...base, leads, looot: a.looot, ledger: open() }), runEnrichment({ ...base, leads, looot: c.looot, ledger: open() })]);
    expect((await b.status(now)).day.usedMicros).toBe(r1.spentMicros);
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("skips calls that would pass the budget and says so", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: 6_000, monthlyMicros: 6_000 });
    const { looot, calls } = runner(() => completed(0.0048));
    const run = await runEnrichment({ ...base, leads: parseLeads("email\na@acme.example\n").leads, looot, ledger: b });
    expect(calls).toHaveLength(1);
    expect(run.skippedByBudget).toBeGreaterThan(0);
    expect(run.budgetMessage).toMatch(/budget/i);
  });

  it("keeps the reservation of a pending call and never records it failed at zero", async () => {
    const b = open();
    const { looot } = runner(() => ({ runId: "run_slow", status: "running" }));
    const run = await runEnrichment({ ...base, leads: parseLeads("email\na@acme.example\n").leads, looot, ledger: b });
    expect(run.pendingCalls).toBeGreaterThan(0);
    expect(run.failedCalls).toBe(0);
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBeGreaterThan(0);
    expect(s.day.usedMicros).toBe(0);
  });

  it("releases the reservation of a failed call", async () => {
    const b = open();
    const { looot } = runner(() => { throw new LoootError("bad input", 400, "invalid_input"); });
    const run = await runEnrichment({ ...base, leads: parseLeads("email\na@acme.example\n").leads, looot, ledger: b });
    expect(run.failedCalls).toBeGreaterThan(0);
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(0);
  });

  it("releases a run looot reports failed at no charge", async () => {
    const b = open();
    const { looot } = runner(() => ({ runId: "r", status: "failed", actualCost: 0, error: { code: "provider_error" } }));
    await runEnrichment({ ...base, leads: parseLeads("email\na@acme.example\n").leads, looot, ledger: b });
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("keeps the reservation when the network fails and the outcome is unknown", async () => {
    const b = open();
    const { looot } = runner(() => { throw new TypeError("fetch failed"); });
    await runEnrichment({ ...base, leads: parseLeads("email\na@acme.example\n").leads, looot, ledger: b });
    expect((await b.status(now)).day.reservedMicros).toBeGreaterThan(0);
  });

  it("is not used in demo mode", async () => {
    const b = open();
    const run = await runEnrichment({ ...base, leads, looot: runner(() => completed(0)).looot, ledger: b, demo: true, now: DEMO_NOW });
    expect(run.spentMicros).toBe(0);
    expect(() => readFileSync(file, "utf8")).toThrow();
  });
});

describe("the budget file", () => {
  it("survives a damaged file by falling back to the defaults", async () => {
    writeFileSync(file, "{not json");
    expect((await open().status(now)).limits).toEqual(DEFAULT_LIMITS);
  });
});

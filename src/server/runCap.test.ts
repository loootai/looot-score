import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as run } from "@/app/api/run/route";
import { resetLimits } from "@/lib/auth/limits";
import { CSRF_HEADER, csrfToken, verifySession } from "@/lib/auth/session";
import { RUNS_PER_WINDOW, serverCapUsd } from "./runtime";

const PW = "test-password-123456";
const KEYS = ["LOOOT_TOKEN", "LOOOT_API_URL", "LOOOT_SCORE_DIR", "LOOOT_SCORE_ICP", "LOOOT_SCORE_ADMIN_PASSWORD", "LOOOT_SCORE_CAP_USD", "LOOOT_SCORE_DEMO"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
let server: Server;
let paidRuns = 0;

beforeAll(async () => {
  // A stand-in for api.looot.ai. The catalog answers 404, so the app prices with its dated fallback prices. Every POST /v1/runs is counted.
  server = createServer((req, res) => {
    if (req.method === "POST") paidRuns++;
    res.statusCode = req.method === "POST" ? 200 : 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ runId: "r", status: "completed", result: {}, actualCost: 0.01 }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.LOOOT_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), ".vitest", "cap-"));
  copyFileSync(join(process.cwd(), "config", "icp.json"), join(dir, "icp.json"));
  process.env.LOOOT_SCORE_DIR = dir;
  process.env.LOOOT_SCORE_ICP = join(dir, "icp.json");
  process.env.LOOOT_SCORE_ADMIN_PASSWORD = PW;
  process.env.LOOOT_TOKEN = "lt_test_token";
  delete process.env.LOOOT_SCORE_DEMO;
  delete process.env.LOOOT_SCORE_CAP_USD;
  paidRuns = 0;
  resetLimits();
});

const H = { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": "198.51.100.5" };
async function session() {
  const res = await login(new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: H, body: JSON.stringify({ password: PW }) }));
  const cookie = /score_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")![0];
  const s = (await verifySession(process.env, cookie.split("=")[1]))!;
  return { cookie, token: await csrfToken(process.env, s.sid) };
}
const CSV = "email,first_name,last_name,domain\nann@acme.example,Ann,Lee,acme.example\nbo@beta.example,Bo,Kim,beta.example\n";
const postRun = async (body: unknown, s: { cookie: string; token: string }) => run(new Request("http://localhost:3000/api/run", { method: "POST", headers: { ...H, cookie: s.cookie, [CSRF_HEADER]: s.token }, body: JSON.stringify(body) }));

describe("the spend cap comes from the server", () => {
  it("defaults to 5 dollars and reads LOOOT_SCORE_CAP_USD", () => {
    expect(serverCapUsd({})).toBe(5);
    expect(serverCapUsd({ LOOOT_SCORE_CAP_USD: "0.5" })).toBe(0.5);
    expect(serverCapUsd({ LOOOT_SCORE_CAP_USD: "-3" })).toBe(5);
    expect(serverCapUsd({ LOOOT_SCORE_CAP_USD: "abc" })).toBe(5);
  });
  it("ignores a capUsd in the request body and refuses a quote above the server cap", async () => {
    process.env.LOOOT_SCORE_CAP_USD = "0.0001";
    const s = await session();
    const res = await postRun({ csv: CSV, capUsd: 1_000_000 }, s);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/above the cap \(\$0\.00\)/);
    expect(paidRuns).toBe(0);
  });
  it("limits runs per session", async () => {
    process.env.LOOOT_SCORE_CAP_USD = "0.0001";
    const s = await session();
    for (let i = 0; i < RUNS_PER_WINDOW; i++) expect((await postRun({ csv: CSV }, s)).status).toBe(400);
    const over = await postRun({ csv: CSV }, s);
    expect(over.status).toBe(429);
    expect(paidRuns).toBe(0);
  });
});

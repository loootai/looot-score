import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, parseArgs } from "./cli";

const dir = path.resolve(".test-out");
const lines: string[] = [];
const out = (s: string) => void lines.push(s);

beforeEach(() => {
  lines.length = 0;
  fs.mkdirSync(dir, { recursive: true });
  process.env.LOOOT_SCORE_DIR = path.join(dir, "state");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.LOOOT_SCORE_DIR;
});

describe("parseArgs", () => {
  it("reads flags and one input file", () => {
    expect(parseArgs(["leads.csv", "--max-spend", "2.5", "--format", "json,md", "--dry-run"])).toMatchObject({ file: "leads.csv", maxSpend: 2.5, formats: ["json", "md"], dryRun: true });
  });
  it("rejects a typo instead of running with defaults", () => {
    expect(() => parseArgs(["--max-spnd", "1"])).toThrow(/Unknown option/);
    expect(() => parseArgs(["--max-spend", "abc"])).toThrow(/dollar amount/);
    expect(() => parseArgs(["--format", "xml"])).toThrow(/Unknown format/);
  });
});

describe("main", () => {
  const csv = () => {
    const f = path.join(dir, "leads.csv");
    fs.writeFileSync(f, "email\na@acme.example\nb@acme.example\nc@globex.example\n");
    return f;
  };
  it("prints the quote on --dry-run and makes no run", async () => {
    const code = await main([csv(), "--dry-run", "--offline"], {}, out);
    const text = lines.join("\n");
    expect(code).toBe(0);
    expect(text).toContain("3 leads");
    expect(text).toContain("Quoted $0.04 at list price");
    expect(text).toContain("no run was made");
    expect(fs.existsSync(path.join(dir, "state"))).toBe(false);
  });
  it("refuses a quote above the cap and runs nothing", async () => {
    const code = await main([csv(), "--max-spend", "0.01", "--offline"], { LOOOT_TOKEN: "t" }, out);
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("Refused: the quote is above the cap");
  });
  it("refuses to run without a token and points at the demo", async () => {
    const code = await main([csv(), "--offline"], {}, out);
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("LOOOT_TOKEN is not set");
  });
  it("runs the demo and writes json, csv and markdown reports", async () => {
    const o = path.join(dir, "reports");
    expect(await main(["--demo", "--out", o], {}, out)).toBe(0);
    const files = fs.readdirSync(o).sort();
    expect(files.map((f) => path.extname(f))).toEqual([".csv", ".json", ".md"]);
    const json = JSON.parse(fs.readFileSync(path.join(o, files.find((f) => f.endsWith(".json"))!), "utf8"));
    expect(json.scores).toHaveLength(40);
    expect(json.scores[0].reasons[0]).toHaveProperty("provider");
    expect(fs.readFileSync(path.join(o, files.find((f) => f.endsWith(".csv"))!), "utf8").split("\n")[0]).toBe("rank,email,first_name,last_name,domain,score,grade,disqualified,components_known,cost_usd,reasons");
    expect(lines.join("\n")).toContain("Grades: A");
  });
  it("uses an ICP file and fails readably on a bad one", async () => {
    const bad = path.join(dir, "icp.json");
    fs.writeFileSync(bad, JSON.stringify({ name: "x" }));
    expect(await main([csv(), "--icp", bad, "--dry-run", "--offline"], {}, out)).toBe(1);
    expect(lines.join("\n")).toMatch(/Invalid .*icp\.json/);
  });
  it("fails on a missing file and on an empty input", async () => {
    expect(await main(["missing.csv"], {}, out)).toBe(1);
    const f = path.join(dir, "e.csv");
    fs.writeFileSync(f, "email\nnope\n");
    expect(await main([f, "--dry-run", "--offline"], {}, out)).toBe(1);
  });
});

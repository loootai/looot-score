import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const range = z.tuple([z.number().min(0), z.number().min(0)]).refine(([a, b]) => a <= b, "range must be [low, high]");
const points = z.number().min(0).max(100);
const list = z.array(z.string());

export const IcpSchema = z.object({
  name: z.string(),
  /** Enrichment calls use one idempotency key per lead and call inside this window. */
  freshnessWindow: z.enum(["week", "month"]),
  concurrency: z.number().int().min(1).max(16),
  /** Lowest score for each grade. Below `C` is D. */
  grades: z.object({ A: z.number().min(0).max(100), B: z.number().min(0).max(100), C: z.number().min(0).max(100) }),
  components: z.object({
    employees: z.object({ points, ideal: range, acceptable: range }),
    industry: z.object({ points, include: list, exclude: list }),
    geography: z.object({ points, include: list }),
    title: z.object({ points, include: list, exclude: list }),
    seniority: z.object({ points, levels: z.record(z.string(), z.number().min(0).max(1)) }),
    tech: z.object({ points, include: list, exclude: list, minMatches: z.number().int().min(1) }),
  }),
  /** Hard rules. A match caps the grade at D whatever the score. */
  disqualify: z.object({ industries: list, titles: list, personalEmailDomains: z.boolean() }),
});

export type Icp = z.infer<typeof IcpSchema>;

export const DEFAULT_ICP_PATH = "config/icp.json";

/** Parses an ICP object. The error names the field that is wrong. */
export function parseIcp(raw: unknown, label = "ICP"): Icp {
  const r = IcpSchema.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new Error(`Invalid ${label}: ${i.path.join(".") || "(root)"}: ${i.message}`);
  }
  const g = r.data.grades;
  if (!(g.A >= g.B && g.B >= g.C)) throw new Error(`Invalid ${label}: grades must satisfy A >= B >= C`);
  const a = r.data.components;
  if (a.employees.ideal[0] < a.employees.acceptable[0] || a.employees.ideal[1] > a.employees.acceptable[1]) throw new Error(`Invalid ${label}: employees.ideal must sit inside employees.acceptable`);
  return r.data;
}

/** Reads and validates an ICP file. */
export function loadIcp(file: string = DEFAULT_ICP_PATH): Icp {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  } catch (e) {
    throw new Error(`Cannot read ICP ${file}: ${(e as Error).message}`);
  }
  return parseIcp(raw, file);
}

/** Writes an ICP file, validated, through a temp file. */
export function saveIcp(icp: Icp, file: string): void {
  parseIcp(icp);
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(icp, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

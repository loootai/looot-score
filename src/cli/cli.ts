import fs from "node:fs";
import path from "node:path";
import { DEMO_NOW, demoCsv, demoRunner } from "../engine/demo";
import { buildQuote, runEnrichment } from "../engine/engine";
import { DEFAULT_ICP_PATH, loadIcp } from "../engine/icp";
import { parseLeads } from "../engine/leads";
import { LoootError, fetchPrices, loootFromEnv } from "../engine/looot";
import { toMicros, usd, usdPrecise } from "../engine/money";
import { FALLBACK_PRICES } from "../engine/providers";
import { toCsv, toJson, toMarkdown } from "../engine/report";
import { distribution, scoreAll } from "../engine/score";
import { writeState } from "../engine/state";
import type { Quote } from "../engine/types";

const HELP = `looot-score: lead and ICP fit scoring on looot

Usage
  npm run score -- <leads.csv> [options]
  npm run score -- --demo

The CSV needs an email column, or name columns and a domain column.

Options
  --icp <file>            ICP config (default ${DEFAULT_ICP_PATH})
  --max-spend <usd>       Per-run spend cap in dollars (default 5)
  --partial               Run until the cap even when the quote is above it
  --out <dir>             Where reports go (default ./out)
  --format json,csv,md    Report formats (default json,csv,md)
  --dry-run               Print the list-price cost and make no run
  --offline               Use the dated prices in the code, read nothing from the catalog
  --demo                  Sample leads and data. No token, no network, no cost
  --help

Environment
  LOOOT_TOKEN             Your looot key. Not needed for --demo or --dry-run
  LOOOT_API_URL           Override the API base (default https://api.looot.ai)
`;

interface Args {
  file?: string;
  icp?: string;
  maxSpend: number;
  partial: boolean;
  out: string;
  formats: string[];
  dryRun: boolean;
  offline: boolean;
  demo: boolean;
  help: boolean;
}

/** Parses argv. Throws on an unknown flag so a typo never runs a paid job with defaults. */
export function parseArgs(argv: string[]): Args {
  const a: Args = { maxSpend: 5, partial: false, out: "out", formats: ["json", "csv", "md"], dryRun: false, offline: false, demo: false, help: false };
  const value = (i: number, flag: string) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    switch (t) {
      case "--icp": a.icp = value(i++, t); break;
      case "--max-spend": {
        const n = Number(value(i++, t));
        if (!Number.isFinite(n) || n < 0) throw new Error("--max-spend needs a dollar amount, for example 5");
        a.maxSpend = n;
        break;
      }
      case "--out": a.out = value(i++, t); break;
      case "--format": a.formats = value(i++, t).split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--partial": a.partial = true; break;
      case "--dry-run": a.dryRun = true; break;
      case "--offline": a.offline = true; break;
      case "--demo": a.demo = true; break;
      case "--help": case "-h": a.help = true; break;
      default:
        if (t.startsWith("--")) throw new Error(`Unknown option ${t}. Run with --help.`);
        if (a.file) throw new Error(`Only one input file is accepted, got ${a.file} and ${t}`);
        a.file = t;
    }
  }
  for (const f of a.formats) if (!["json", "csv", "md"].includes(f)) throw new Error(`Unknown format ${f}. Use json, csv or md.`);
  return a;
}

function quoteTable(q: Quote): string {
  const rows = q.lines.map((l) => `  ${l.label.padEnd(28)} ${l.provider.padEnd(16)} ${l.jobId.padEnd(24)} ${usdPrecise(l.priceMicros).padStart(9)} x ${String(l.calls).padStart(5)} = ${usdPrecise(l.totalMicros).padStart(9)}`);
  return [...rows, `  Prices: ${q.priceSource === "catalog" ? "read from the public looot catalog" : "dated fallback in the code"}`].join("\n");
}

/** Runs the CLI. Returns the exit code: 0 done, 1 error, 2 refused (over the cap, no token). */
export async function main(argv: string[], env: Record<string, string | undefined> = process.env, out: (s: string) => void = (s) => process.stdout.write(`${s}\n`)): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    out((e as Error).message);
    return 1;
  }
  if (args.help || argv.length === 0) {
    out(HELP);
    return args.help ? 0 : 1;
  }
  try {
    const icp = loadIcp(args.icp);
    let text: string;
    if (args.demo && !args.file) text = demoCsv();
    else if (args.file) text = fs.readFileSync(args.file, "utf8");
    else {
      out("Give a leads CSV file or --demo. Run with --help.");
      return 1;
    }
    const { leads, rejected } = parseLeads(text);
    if (rejected.length) out(`Skipped ${rejected.length} rows: ${rejected.slice(0, 3).join("; ")}${rejected.length > 3 ? "; ..." : ""}`);
    if (leads.length === 0) {
      out("No usable leads in the input.");
      return 1;
    }

    const capMicros = toMicros(args.maxSpend);
    let prices = { ...FALLBACK_PRICES };
    let priceSource: Quote["priceSource"] = "fallback";
    let unpriced: string[] = [];
    if (!args.demo && !args.offline) {
      const live = await fetchPrices(FALLBACK_PRICES);
      prices = live.prices;
      priceSource = live.source;
      unpriced = live.unread;
    }
    if (args.demo) priceSource = "catalog";
    if (args.offline) out("Offline: using the dated prices in the code (2026-10-10), not the live catalog.");
    const quote = buildQuote(leads, icp, prices, priceSource);
    out(`${leads.length} leads.`);
    out(quoteTable(quote));
    out(`Quoted ${usd(quote.totalMicros)} at list price (${usdPrecise(Math.round(quote.totalMicros / leads.length))} per lead). Cap ${usd(capMicros)}.`);
    if (unpriced.length) out(`Live price unreadable for ${unpriced.join(", ")}. Those calls will be skipped.`);

    if (args.dryRun) {
      out("Dry run: no run was made and nothing was charged.");
      return 0;
    }
    if (quote.totalMicros > capMicros && !args.partial && !args.demo) {
      out("Refused: the quote is above the cap. Raise --max-spend, score fewer leads, or pass --partial to run until the cap.");
      return 2;
    }
    let looot;
    if (args.demo) looot = demoRunner();
    else {
      try {
        looot = loootFromEnv(env);
      } catch (e) {
        if (e instanceof LoootError && e.code === "missing_token") {
          out("LOOOT_TOKEN is not set. Create a key at https://looot.ai, or try --demo or --dry-run.");
          return 2;
        }
        throw e;
      }
    }
    const run = await runEnrichment({ leads, rejected, icp, looot, prices, priceSource, unpriced, capMicros, now: args.demo ? DEMO_NOW : new Date(), demo: args.demo, onProgress: (d, t) => (d % 10 === 0 || d === t) && out(`  ${d}/${t}`) });
    const scores = scoreAll(run.profiles, icp);

    fs.mkdirSync(args.out, { recursive: true });
    const base = path.join(args.out, `score-${run.runId}`);
    const written: string[] = [];
    if (args.formats.includes("json")) {
      fs.writeFileSync(`${base}.json`, toJson(run, scores));
      written.push(`${base}.json`);
    }
    if (args.formats.includes("csv")) {
      fs.writeFileSync(`${base}.csv`, toCsv(scores));
      written.push(`${base}.csv`);
    }
    if (args.formats.includes("md")) {
      fs.writeFileSync(`${base}.md`, toMarkdown(run, scores));
      written.push(`${base}.md`);
    }
    if (!args.demo) writeState({ run, icp: null });

    const d = distribution(scores);
    out("");
    out(`Grades: A ${d.A}, B ${d.B}, C ${d.C}, D ${d.D}`);
    out(`Spent ${usd(run.spentMicros)} of ${usd(capMicros)} cap.${run.pendingCalls ? ` ${run.pendingCalls} calls pending, run again to collect them without a second charge.` : ""}${run.skippedByCap ? ` ${run.skippedByCap} calls skipped by the cap.` : ""}${run.failedCalls ? ` ${run.failedCalls} calls failed.` : ""}`);
    if (run.aborted) out(run.aborted);
    for (const w of written) out(`Wrote ${w}`);
    return run.aborted ? 1 : 0;
  } catch (e) {
    out(`Error: ${(e as Error).message}`);
    return 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

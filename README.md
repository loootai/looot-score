# looot-score

An open-source alternative to [MadKudu](https://www.madkudu.com) for lead and ICP fit scoring. Third-party listings put MadKudu's entry plan at $999 a month; its own pricing page redirected to HG Insights and could not be read (checked 2026-10-10). looot-score enriches a CSV of leads through [looot](https://looot.ai), scores each one against an ICP you edit, and returns a grade A to D with the reasons.

![Dashboard, light](docs/screenshots/dashboard-light.png)

## What it does

Upload a CSV with an email column, or name columns and a domain column. For each lead it fetches the person (title, seniority) and the company (industry, headcount, country, tech stack) from named providers, then scores six criteria from the ICP and grades the lead.

- Every grade lists the criteria behind it, the points each earned, the fact found and the provider that supplied it.
- A fact no provider returned earns nothing and is marked unknown. Nothing is guessed.
- Enrichment is stored. Editing the ICP re-scores every stored lead at no cost and with no looot call.
- The quote comes first. A per-run spend cap is enforced before each call. A company or tech stack is fetched once per domain, whatever the number of leads. A call still running when waiting stops is `pending`, never "failed at $0".
- Hard rules cap the grade at D: a disqualified industry or title, or a personal mailbox with no company domain.

Three ways to run it: a demo with sample leads, a headless CLI, and a web UI on the same engine.

| Page | Light | Dark |
| --- | --- | --- |
| Upload, quote, grades, lead table with reasons | ![](docs/screenshots/dashboard-light.png) | ![](docs/screenshots/dashboard-dark.png) |
| ICP editor | ![](docs/screenshots/icp-light.png) | ![](docs/screenshots/icp-dark.png) |

## Quick start

```bash
npm install --ignore-scripts
npm run demo          # http://localhost:3272, 40 sample leads, no token, no network, no cost
```

Headless, with your key:

```bash
export LOOOT_TOKEN=...                       # from https://looot.ai
npm run score -- data/sample-leads.csv --dry-run
npm run score -- leads.csv --icp config/icp.json --max-spend 5
```

`--dry-run` prints the list-price quote and makes no run. Without it the CLI prints the quote, refuses when it is above `--max-spend` (`--partial` runs until the cap), and writes `score-<run>.json`, `.csv` and `.md` to `./out`. Run `npm run score -- --help` for all flags. Exit codes: 0 done, 1 error, 2 refused (over the cap or no token).

The web UI on a live key: set `LOOOT_TOKEN`, run `npm run dev`. The ICP editor writes `config/icp.json`, which the CLI reads. Results are saved to `.looot-score/state.json`. Supabase auth is not used.

## The ICP file

`config/icp.json`, validated on load, edited in the UI or by hand.

| Criterion | Default points | What earns points |
| --- | --- | --- |
| Company size | 25 | Headcount in the ideal range, full. In the acceptable range, half. |
| Industry | 20 | A target industry word matches, whole word, any case. |
| Country | 10 | Country code or name is on the list. |
| Job title | 15 | A target title word matches. |
| Seniority | 20 | Share per level (c-suite, vp, head, director, manager, senior, entry), 0 to 1. |
| Tech stack | 10 | Enough target technologies detected. A listed exclusion scores zero. |

Score = points earned over the points of the criteria in use, times 100. A criterion with empty lists is not in use and drops out of both sides. Grade cut-offs default to A from 75, B from 55, C from 35, D below. If both tech lists are empty the tech call is not made and not paid for.

## Calls

Job ids and prices are from the public looot catalog, read 2026-10-10, per call in USD.

| Fact | Provider | looot job | Endpoint | Price |
| --- | --- | --- | --- | --- |
| Title, seniority, company, by email | quickenrich | `people.enrich.by-email` | `quickenrich-api-employees-email-search` | $0.00483 |
| Title, seniority, by name and domain | dropleads | `people.enrich` | `dropleads-simple-enrich` | $0.0029 |
| Industry, headcount, country | thecompaniesapi | `company.enrich` | `thecompaniesapi-companies-by-email` | $0.0019 |
| Tech stack | PredictLeads | `company.technographics` | `predictleads-companies-technology-detections` | $0.0100 |

The company call is sent `info@<domain>` because the endpoint looks a company up from an email's domain. The tech fetcher is copied from looot-intent, with no dependency between the repos.

One person call per lead, one company call and one tech call per domain. With three leads per company, a lead costs about $0.008. With one lead per company, $0.0167. So 100 leads is about $0.83 to $1.67 at list price, and 1,000 leads $8 to $17.

## What is dropped, and what is not tested

- No behavioural or engagement scoring, no predictive model trained on your closed-won deals, no CRM sync. MadKudu has these. This tool grades fit only, from rules you can read.
- MadKudu grades run A to E. This one runs A to D, as asked.
- No paid looot run was made. Request fields follow each endpoint's documented parameters. Response parsers are built from provider docs and fixtures and read defensively, but no real response body has been checked against them. `shapeVerified` is `false` for every call in `src/engine/providers.ts`. Run `--dry-run` and a 5-lead run first, and expect to adjust a parser.
- Headcount ranges such as "51-200" are scored at their middle value.
- Demo leads use the reserved `.example` domain. The data is generated, not real.

## Install for agents

```bash
git clone https://github.com/loootai/looot-score && cd looot-score && npm install --ignore-scripts
```

Claude Code: copy `skills/looot-score` to `~/.claude/skills/looot-score`. The skill runs the CLI with `--dry-run` first, then the real run with a cap. Other agents: read [llms.txt](llms.txt).

## Develop

```bash
npm test && npm run typecheck && npm run lint && npm run build
npm run leak-scan                 # also runs from .githooks/pre-commit: git config core.hooksPath .githooks
```

Layout: `src/engine` (client, lead parsing, providers, scoring, run loop, reports, no framework imports), `src/cli`, `src/server` and `src/app` (Next.js App Router), `config/icp.json`, `data/sample-leads.csv`.

MIT licence, copyright looot.

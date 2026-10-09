---
name: looot-score
description: Grade a CSV of leads A to D against an ICP with reasons, using the looot-score CLI. Use when asked to score leads, check lead fit, grade a lead list, or replace a MadKudu-style fit score.
---

# looot-score

Runs the looot-score CLI from a clone of https://github.com/loootai/looot-score.

1. The leads file is a CSV with an `email` column, or `first_name`, `last_name` and `domain` columns.
2. Quote first, no charge:
   `npm run score -- <leads.csv> --max-spend <usd> --dry-run`
   Show the user the total and the per-call table. Ask before spending.
3. Real run, needs `LOOOT_TOKEN` in the environment:
   `npm run score -- <leads.csv> --max-spend <usd>`
   Exit code 2 means refused (quote above the cap, or no token). Do not raise the cap on your own.
4. Read `out/score-<run>.md`. Report the grade counts and the top leads, and for any lead the user asks about, the reasons with the provider behind each. A criterion marked unknown had no data. Do not fill it in.
5. If the summary line shows pending calls, run the same command again within the month. Finished calls replay at no charge.

To try it without a key: `npm run score -- --demo`.

The ICP is `config/icp.json`. Change it only when the user asks, then re-run `--dry-run`.

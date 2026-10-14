# Changelog

## Unreleased

- Fix: sign-in from Chrome failed with "Cross-site request refused" (403). The app sends `Referrer-Policy: no-referrer`, so Chrome posts the form with `Origin: null`. The same-origin check now falls back to `Sec-Fetch-Site: same-origin` when the origin is `null`. A request from another site, or with no `Sec-Fetch-Site`, is still refused.
- Fix: company headcount. thecompaniesapi returns `totalEmployees` as a range string ("1-10") next to `totalEmployeesExact` (7220 for HubSpot). The parser read the range, so every large company scored as 6 employees. It now reads the exact number first.
- Company rows: a CSV with only a `domain` column (no email, no name) is accepted. The row costs one company call and one tech call and no person call. Title and seniority then score as unknown, so set their points to 0 in the ICP for a company-only fit score.

## 0.1.4

Spend limits, version 2. Before this, a paid run was limited only by the cap per run, an in-memory rate limit and the token balance. Repeating a request could be charged again, nothing limited spend across runs, and two requests started together could both pass the cap.

- Period budget: a daily and a monthly amount (UTC), $10 and $50 by default, saved in `budget.json`. The signed-in owner changes it on the new Costs page (`PUT /api/budget`). A run request cannot raise it.
- Reserve then settle: each paid call reserves its list price under a lock file before it is made, and is refused if used plus reserved plus the price would pass either budget. The reservation becomes the real cost when the call ends and goes back if the call failed. A call still running keeps its reservation. The next run looks up pending calls with `GET /v1/runs/{id}` and settles them. A reservation that cannot be looked up is released after 24 hours.
- Stored results: a finished call is stored under its stable key (call, normalised input, freshness window), so the same request inside the window is answered with no call and no charge.
- The sidebar spend panel and the Costs page show used, reserved and remaining for today and this month. The CLI refuses a run above what is left of the budget unless `--partial` is passed.
- README: the Spending and Securing a deployment sections describe the new limits. The token balance is still the final limit.

Migration: none. This repo has no database. The budget is a new file, `budget.json`, created in `LOOOT_SCORE_DIR` on first use. Nothing to run. Run one instance on a persistent disk, since the file is not shared between hosts.

## 0.1.3

Admin sign-in for every admin page and route, CSRF protection and a server-side spend cap per run.

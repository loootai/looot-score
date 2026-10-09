import type { Icp } from "./icp";
import { emailDomain, PERSONAL_EMAIL_DOMAINS } from "./leads";
import type { ComponentId, Grade, LeadScore, Profile, ReasonLine } from "./types";

const COUNTRY_CODE: Record<string, string> = { "united states": "us", usa: "us", "united kingdom": "gb", uk: "gb", "great britain": "gb", germany: "de", france: "fr", canada: "ca", netherlands: "nl", spain: "es", italy: "it", australia: "au", ireland: "ie", sweden: "se", switzerland: "ch", india: "in", brazil: "br" };

/** Two-letter lower-case code for a country name or code. */
export function countryCode(c: string): string {
  const k = c.trim().toLowerCase();
  return COUNTRY_CODE[k] ?? k;
}

const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
/** true when any term appears as a whole word or phrase in the text. */
export function hasTerm(text: string, terms: string[]): string | undefined {
  const t = words(text);
  return terms.find((term) => term.trim() && t.includes(words(term)));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Scores one enriched lead against the ICP. Pure: the same profile and ICP give the same score. */
export function scoreProfile(p: Profile, icp: Icp): LeadScore {
  const c = icp.components;
  const reasons: ReasonLine[] = [];
  const line = (component: ComponentId, label: string, max: number, fraction: number | null, detail: string, provider: string | null) => {
    reasons.push({ component, label, max, known: fraction !== null, points: round1(max * (fraction ?? 0)), detail, provider });
  };
  const co = p.company;
  const unknown = (what: string) => `No provider returned ${what}. No points.`;

  if (c.employees.points > 0) {
    const n = co.employees;
    const [il, ih] = c.employees.ideal;
    const [al, ah] = c.employees.acceptable;
    if (n === undefined) line("employees", "Company size", c.employees.points, null, unknown("a headcount"), null);
    else if (n >= il && n <= ih) line("employees", "Company size", c.employees.points, 1, `${n.toLocaleString("en-US")} employees, inside the ideal ${il}-${ih}.`, co.from.employees ?? null);
    else if (n >= al && n <= ah) line("employees", "Company size", c.employees.points, 0.5, `${n.toLocaleString("en-US")} employees, outside the ideal ${il}-${ih} but inside ${al}-${ah}. Half the points.`, co.from.employees ?? null);
    else line("employees", "Company size", c.employees.points, 0, `${n.toLocaleString("en-US")} employees, outside ${al}-${ah}.`, co.from.employees ?? null);
  }

  if (c.industry.points > 0 && (c.industry.include.length > 0 || c.industry.exclude.length > 0)) {
    const ind = co.industry;
    if (!ind) line("industry", "Industry", c.industry.points, null, unknown("an industry"), null);
    else if (hasTerm(ind, c.industry.exclude)) line("industry", "Industry", c.industry.points, 0, `${ind} is on the exclude list.`, co.from.industry ?? null);
    else if (c.industry.include.length === 0) line("industry", "Industry", c.industry.points, 1, `${ind} is not excluded.`, co.from.industry ?? null);
    else {
      const hit = hasTerm(ind, c.industry.include);
      line("industry", "Industry", c.industry.points, hit ? 1 : 0, hit ? `${ind} matches "${hit}".` : `${ind} matches none of the target industries.`, co.from.industry ?? null);
    }
  }

  if (c.geography.points > 0 && c.geography.include.length > 0) {
    const cc = co.country;
    if (!cc) line("geography", "Country", c.geography.points, null, unknown("a country"), null);
    else {
      const ok = c.geography.include.some((x) => countryCode(x) === countryCode(cc));
      line("geography", "Country", c.geography.points, ok ? 1 : 0, ok ? `${cc} is a target country.` : `${cc} is not in the target countries.`, co.from.country ?? null);
    }
  }

  const title = p.person.title;
  if (c.title.points > 0 && (c.title.include.length > 0 || c.title.exclude.length > 0)) {
    if (!title) line("title", "Job title", c.title.points, null, unknown("a job title"), null);
    else if (hasTerm(title, c.title.exclude)) line("title", "Job title", c.title.points, 0, `"${title}" is on the exclude list.`, p.person.titleFrom ?? null);
    else if (c.title.include.length === 0) line("title", "Job title", c.title.points, 1, `"${title}" is not excluded.`, p.person.titleFrom ?? null);
    else {
      const hit = hasTerm(title, c.title.include);
      line("title", "Job title", c.title.points, hit ? 1 : 0, hit ? `"${title}" matches "${hit}".` : `"${title}" matches none of the target title words.`, p.person.titleFrom ?? null);
    }
  }

  if (c.seniority.points > 0) {
    const s = p.person.seniority;
    if (!s) line("seniority", "Seniority", c.seniority.points, null, unknown("a seniority level"), null);
    else {
      const f = c.seniority.levels[s] ?? 0;
      line("seniority", "Seniority", c.seniority.points, f, `${s.replace("_", "-")} earns ${Math.round(f * 100)}% of the points.`, p.person.titleFrom ?? null);
    }
  }

  if (c.tech.points > 0 && (c.tech.include.length > 0 || c.tech.exclude.length > 0)) {
    const techs = co.technologies;
    if (!techs) line("tech", "Tech stack", c.tech.points, null, unknown("a tech stack"), null);
    else {
      const joined = techs.join(" | ");
      const bad = hasTerm(joined, c.tech.exclude);
      const found = c.tech.include.filter((t) => hasTerm(joined, [t]));
      if (bad) line("tech", "Tech stack", c.tech.points, 0, `Uses ${bad}, which is on the exclude list.`, co.from.technologies ?? null);
      else if (c.tech.include.length === 0) line("tech", "Tech stack", c.tech.points, 1, "No excluded technology found.", co.from.technologies ?? null);
      else line("tech", "Tech stack", c.tech.points, Math.min(1, found.length / c.tech.minMatches), found.length ? `Uses ${found.join(", ")}.` : `None of ${c.tech.include.join(", ")} detected.`, co.from.technologies ?? null);
    }
  }

  const max = reasons.reduce((n, r) => n + r.max, 0);
  const earned = reasons.reduce((n, r) => n + r.points, 0);
  const score = max > 0 ? Math.round((100 * earned) / max) : 0;
  let grade: Grade = score >= icp.grades.A ? "A" : score >= icp.grades.B ? "B" : score >= icp.grades.C ? "C" : "D";

  let disqualified: string | null = null;
  const d = icp.disqualify;
  const mailDomain = emailDomain(p.lead.email);
  if (d.personalEmailDomains && mailDomain && PERSONAL_EMAIL_DOMAINS.has(mailDomain) && !p.lead.domain) disqualified = `Personal email address (${mailDomain}) and no company domain.`;
  else if (co.industry && hasTerm(co.industry, d.industries)) disqualified = `Industry "${co.industry}" is disqualified.`;
  else if (title && hasTerm(title, d.titles)) disqualified = `Title "${title}" is disqualified.`;
  if (disqualified) grade = "D";

  return {
    lead: p.lead,
    score,
    grade,
    disqualified,
    reasons,
    coverage: { known: reasons.filter((r) => r.known).length, active: reasons.length },
    costMicros: p.costMicros,
    pending: p.calls.some((x) => x.status === "pending"),
  };
}

/** Scores every profile and sorts best first. */
export function scoreAll(profiles: Profile[], icp: Icp): LeadScore[] {
  return profiles.map((p) => scoreProfile(p, icp)).sort((a, b) => b.score - a.score || a.lead.id.localeCompare(b.lead.id, "en", { numeric: true }));
}

/** Count of leads per grade. */
export function distribution(scores: LeadScore[]): Record<Grade, number> {
  const out: Record<Grade, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const s of scores) out[s.grade] += 1;
  return out;
}

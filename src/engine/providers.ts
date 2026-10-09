import { findNumber, findString, findStringList, flat, isRec, rowsOf } from "./read";
import type { CallKind, CompanyFacts, PersonFacts, Seniority } from "./types";

export interface Facts {
  person?: PersonFacts;
  company?: Partial<Omit<CompanyFacts, "from">>;
}

export interface ProviderDef {
  kind: CallKind;
  label: string;
  provider: string;
  /** looot job id, kept as the catalog reference. */
  jobId: string;
  endpointId: string;
  /** Price per call in micro-dollars from the public catalog on PRICES_AS_OF. */
  fallbackMicros: number;
  /** false until someone has checked a real response body against the parser. */
  shapeVerified: boolean;
  parse(result: unknown): Facts;
}

export const PRICES_AS_OF = "2026-10-10";

/** Seniority from a job title. Order matters: the first match wins. */
export function seniorityOf(title: string | undefined): Seniority | undefined {
  if (!title) return undefined;
  const t = ` ${title.toLowerCase().replace(/[^a-z0-9&]+/g, " ")} `;
  const has = (re: RegExp) => re.test(t);
  if (has(/ (vp|svp|evp|vice president) /)) return "vp";
  if (has(/ (chief|ceo|cto|cfo|cmo|coo|cro|cpo|ciso|founder|co founder|cofounder|owner|president|managing director) /)) return "c_suite";
  if (has(/ head of /)) return "head";
  if (has(/ director /)) return "director";
  if (has(/ (manager|lead|supervisor) /)) return "manager";
  if (has(/ (senior|sr|principal|staff) /)) return "senior";
  return "entry";
}

const SENIORITY_WORDS: Record<string, Seniority> = { executive: "c_suite", c_suite: "c_suite", "c-suite": "c_suite", owner: "c_suite", founder: "c_suite", vp: "vp", vice_president: "vp", head: "head", director: "director", manager: "manager", senior: "senior", entry: "entry", junior: "entry", intern: "entry" };

function personFrom(result: unknown, provider: string): PersonFacts {
  const title = findString(result, ["title", "job_title", "jobTitle", "position", "headline", "role"]);
  const given = findString(result, ["seniority", "seniority_level", "management_level"])?.toLowerCase().replace(/\s+/g, "_");
  const seniority = (given && SENIORITY_WORDS[given]) || seniorityOf(title);
  return title || seniority ? { title, seniority, titleFrom: provider } : {};
}

/** Parses "51-200", "1,001 to 5,000", "10001+" or a number into one headcount (the middle of a range). */
export function parseEmployees(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.round(v);
  if (typeof v !== "string") return undefined;
  const nums = (v.replace(/,/g, "").match(/\d+/g) ?? []).map(Number);
  if (nums.length === 0) return undefined;
  if (nums.length >= 2) return Math.round((nums[0] + nums[1]) / 2);
  return nums[0];
}

/** A country from `countryCode`, or from a `country` that is a string or a {code, name} object, anywhere in the body. */
function findCountry(v: unknown, depth = 0): string | undefined {
  if (depth > 8) return undefined;
  const direct = findString(v, ["countryCode", "country_code"]);
  if (direct) return direct;
  if (isRec(v)) {
    const c = v.country;
    if (typeof c === "string" && c.trim()) return c.trim();
    if (isRec(c)) {
      const s = findString(c, ["code", "alpha2", "iso2", "name"]);
      if (s) return s;
    }
    for (const x of Object.values(v)) {
      const s = findCountry(x, depth + 1);
      if (s) return s;
    }
  } else if (Array.isArray(v)) {
    for (const x of v) {
      const s = findCountry(x, depth + 1);
      if (s) return s;
    }
  }
  return undefined;
}

function companyFrom(result: unknown): NonNullable<Facts["company"]> {
  const rawEmployees = findNumber(result, ["totalEmployees", "employees", "employee_count", "employeeCount", "headcount"]) ?? findString(result, ["employees", "totalEmployees", "employee_count", "employeesRange", "employees_range", "company_size", "size"]);
  const country = findCountry(result);
  const technologies = findStringList(result, ["technologies", "tech", "tech_stack", "techStack"]);
  const out: NonNullable<Facts["company"]> = {};
  const industry = findString(result, ["industryMain", "industry", "industries", "sector", "category"]);
  const employees = parseEmployees(rawEmployees);
  if (industry) out.industry = industry;
  if (employees !== undefined) out.employees = employees;
  if (country) out.country = country;
  if (technologies) out.technologies = technologies;
  return out;
}

/** The four calls this app makes. Job ids and prices come from the free looot catalog. */
export const PROVIDERS: Record<CallKind, ProviderDef> = {
  person_by_email: {
    kind: "person_by_email",
    label: "Person and company by email",
    provider: "quickenrich",
    jobId: "people.enrich.by-email",
    endpointId: "quickenrich-api-employees-email-search",
    fallbackMicros: 4_830,
    shapeVerified: false,
    parse: (r) => ({ person: personFrom(r, "quickenrich"), company: companyFrom(r) }),
  },
  person_by_name: {
    kind: "person_by_name",
    label: "Person by name and domain",
    provider: "dropleads",
    jobId: "people.enrich",
    endpointId: "dropleads-simple-enrich",
    fallbackMicros: 2_900,
    shapeVerified: false,
    parse: (r) => ({ person: personFrom(r, "dropleads") }),
  },
  company: {
    kind: "company",
    label: "Company firmographics",
    provider: "thecompaniesapi",
    jobId: "company.enrich",
    endpointId: "thecompaniesapi-companies-by-email",
    fallbackMicros: 1_900,
    shapeVerified: false,
    parse: (r) => ({ company: companyFrom(r) }),
  },
  tech: {
    kind: "tech",
    label: "Tech stack",
    provider: "predictleads",
    jobId: "company.technographics",
    endpointId: "predictleads-companies-technology-detections",
    fallbackMicros: 10_000,
    shapeVerified: false,
    parse(result) {
      const names = new Map<string, string>();
      if (isRec(result) && Array.isArray(result.included)) {
        for (const inc of result.included) {
          if (isRec(inc) && typeof inc.id === "string") {
            const n = flat(inc).name;
            if (typeof n === "string") names.set(inc.id, n);
          }
        }
      }
      const techs = rowsOf(result, ["data"]).map((raw) => {
        const rel = isRec(raw.relationships) && isRec(raw.relationships.technology) && isRec(raw.relationships.technology.data) ? raw.relationships.technology.data : undefined;
        const a = flat(raw);
        return (rel && typeof rel.id === "string" ? names.get(rel.id) : undefined) ?? (typeof a.technology_name === "string" ? a.technology_name : typeof a.name === "string" ? a.name : undefined);
      });
      return { company: { technologies: [...new Set(techs.filter((x): x is string => Boolean(x)))] } };
    },
  },
};

/** Fallback prices keyed by endpoint id. */
export const FALLBACK_PRICES: Record<string, number> = Object.fromEntries(Object.values(PROVIDERS).map((p) => [p.endpointId, p.fallbackMicros]));

/** The input for each call. The company call sends info@<domain>: the endpoint looks a company up from an email's domain. */
export function inputFor(kind: CallKind, arg: { email?: string; firstName?: string; lastName?: string; domain?: string }): Record<string, unknown> {
  switch (kind) {
    case "person_by_email":
      return { email: arg.email };
    case "person_by_name":
      return { first_name: arg.firstName, last_name: arg.lastName, domain: arg.domain };
    case "company":
      return { email: `info@${arg.domain}` };
    case "tech":
      return { company_id_or_domain: arg.domain, limit: 100 };
  }
}

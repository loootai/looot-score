import type { Runner } from "./looot";

/** The clock demo data is relative to, so screenshots and tests do not drift. */
export const DEMO_NOW = new Date("2026-10-10T09:00:00.000Z");

interface DemoCompany {
  domain: string;
  industry: string;
  employees: number;
  country: string;
  tech: string[];
}

const COMPANIES: DemoCompany[] = [
  { domain: "brightpath.example", industry: "Software", employees: 180, country: "US", tech: ["HubSpot", "Segment", "Stripe"] },
  { domain: "loomwork.example", industry: "Computer Software", employees: 320, country: "GB", tech: ["Salesforce", "Slack"] },
  { domain: "ironvale.example", industry: "Industrial Manufacturing", employees: 900, country: "DE", tech: ["SAP"] },
  { domain: "kitefin.example", industry: "Financial Services", employees: 60, country: "US", tech: ["Salesforce", "Snowflake"] },
  { domain: "pinecrest-edu.example", industry: "Education", employees: 400, country: "US", tech: ["Canvas"] },
  { domain: "novasend.example", industry: "Internet", employees: 45, country: "NL", tech: ["HubSpot", "Intercom"] },
  { domain: "harbor-legal.example", industry: "Law Practice", employees: 25, country: "US", tech: [] },
  { domain: "stackhouse.example", industry: "Information Technology", employees: 1200, country: "US", tech: ["Salesforce", "HubSpot", "Outreach"] },
  { domain: "tinyfox.example", industry: "Software", employees: 6, country: "FR", tech: ["Notion"] },
  { domain: "gridline.example", industry: "SaaS", employees: 700, country: "CA", tech: ["Outreach", "Segment"] },
  { domain: "greenacre.example", industry: "Agriculture", employees: 150, country: "AU", tech: [] },
  { domain: "coralbay.example", industry: "Government Administration", employees: 300, country: "US", tech: ["Microsoft 365"] },
];

const PEOPLE: { first: string; last: string; title: string }[] = [
  { first: "Maya", last: "Okafor", title: "VP of Sales" },
  { first: "Jonas", last: "Lindqvist", title: "Head of Marketing" },
  { first: "Priya", last: "Raman", title: "Director of Revenue Operations" },
  { first: "Tomas", last: "Varga", title: "Account Executive" },
  { first: "Elise", last: "Moreau", title: "Software Engineer" },
  { first: "Dario", last: "Conti", title: "CEO" },
  { first: "Hana", last: "Sato", title: "Marketing Manager" },
  { first: "Kofi", last: "Mensah", title: "Marketing Intern" },
  { first: "Lena", last: "Vogel", title: "Founder" },
  { first: "Ravi", last: "Kulkarni", title: "Senior SDR" },
  { first: "Nora", last: "Bell", title: "Chief Financial Officer" },
  { first: "Ines", last: "Duarte", title: "Operations Manager" },
];

interface DemoLead {
  email?: string;
  first: string;
  last: string;
  domain?: string;
  company: string;
  title: string;
  /** Company index. */
  c: number;
}

function buildLeads(): DemoLead[] {
  const out: DemoLead[] = [];
  for (let c = 0; c < COMPANIES.length; c++) {
    for (let k = 0; k < 3; k++) {
      const p = PEOPLE[(c * 5 + k * 7) % PEOPLE.length];
      const co = COMPANIES[c];
      const name = co.domain.split(".")[0];
      out.push({ email: `${p.first}.${p.last}@${co.domain}`.toLowerCase(), first: p.first, last: p.last, company: name, title: p.title, c });
    }
  }
  // Two leads from a personal mailbox with a company domain, two with name and domain only.
  out.push({ email: "dario.conti@gmail.com", first: "Dario", last: "Conti", domain: "gridline.example", company: "gridline", title: "CEO", c: 9 });
  out.push({ email: "someone.private@gmail.com", first: "Alex", last: "Quinn", company: "unknown", title: "Consultant", c: -1 });
  out.push({ first: "Maya", last: "Okafor", domain: "brightpath.example", company: "brightpath", title: "VP of Sales", c: 0 });
  out.push({ first: "Hana", last: "Sato", domain: "novasend.example", company: "novasend", title: "Marketing Manager", c: 5 });
  return out;
}

const LEADS = buildLeads();

/** The sample CSV the demo and the README use. */
export function demoCsv(): string {
  const rows = LEADS.map((l) => [l.email ?? "", l.first, l.last, l.domain ?? "", l.company].map((x) => (x.includes(",") ? `"${x}"` : x)).join(","));
  return ["email,first_name,last_name,domain,company", ...rows].join("\n") + "\n";
}

const seniorityWord = (t: string) => (/chief|ceo|founder/i.test(t) ? "executive" : /vp|vice/i.test(t) ? "vp" : /head/i.test(t) ? "head" : /director/i.test(t) ? "director" : /manager/i.test(t) ? "manager" : /senior/i.test(t) ? "senior" : "entry");

/** Stands in for looot in demo mode. It plays provider-shaped fixtures and makes no network call. */
export function demoRunner(): Runner {
  const byDomain = new Map(COMPANIES.map((c) => [c.domain, c]));
  const byEmail = new Map(LEADS.filter((l) => l.email).map((l) => [l.email!, l]));
  const byName = new Map(LEADS.map((l) => [`${l.first} ${l.last}`.toLowerCase(), l]));
  const body = (endpointId: string, input: Record<string, unknown>): unknown => {
    switch (endpointId) {
      case "quickenrich-api-employees-email-search": {
        const l = byEmail.get(String(input.email));
        const co = l && l.c >= 0 ? COMPANIES[l.c] : undefined;
        if (!l) return { data: null };
        return { data: { person: { first_name: l.first, last_name: l.last, job_title: l.title }, company: co ? { name: co.domain.split(".")[0], industry: co.industry, employees: co.employees } : null } };
      }
      case "dropleads-simple-enrich": {
        const l = byName.get(`${input.first_name} ${input.last_name}`.toLowerCase());
        return l ? { lead: { first_name: l.first, last_name: l.last, title: l.title, seniority: seniorityWord(l.title) } } : { lead: null };
      }
      case "thecompaniesapi-companies-by-email": {
        const co = byDomain.get(String(input.email).split("@")[1]);
        return co ? { company: { name: co.domain.split(".")[0], domain: co.domain, industryMain: co.industry, totalEmployees: co.employees, locations: [{ country: { code: co.country } }] } } : { company: null };
      }
      case "predictleads-companies-technology-detections": {
        const co = byDomain.get(String(input.company_id_or_domain));
        const techs = co?.tech ?? [];
        return { data: techs.map((_, i) => ({ id: `d${i}`, attributes: {}, relationships: { technology: { data: { id: `t${i}` } } } })), included: techs.map((name, i) => ({ id: `t${i}`, attributes: { name } })) };
      }
      default:
        return {};
    }
  };
  return {
    async runAndWait(endpointId, input, key) {
      return { runId: `demo_${key.split(":").slice(2, 4).join("_")}`, status: "completed", result: body(endpointId, input), actualCost: 0 };
    },
  };
}

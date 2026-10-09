import { describe, expect, it } from "vitest";
import { PROVIDERS, inputFor, parseEmployees, seniorityOf } from "./providers";

describe("seniorityOf", () => {
  it.each([
    ["Chief Revenue Officer", "c_suite"],
    ["Co-Founder", "c_suite"],
    ["VP of Sales", "vp"],
    ["Vice President, Marketing", "vp"],
    ["Head of Growth", "head"],
    ["Director of Revenue Operations", "director"],
    ["Marketing Manager", "manager"],
    ["Senior SDR", "senior"],
    ["Account Executive", "entry"],
  ])("%s is %s", (title, level) => expect(seniorityOf(title)).toBe(level));
  it("returns nothing for no title", () => expect(seniorityOf(undefined)).toBeUndefined());
});

describe("parseEmployees", () => {
  it("reads numbers, ranges and open ranges", () => {
    expect(parseEmployees(240)).toBe(240);
    expect(parseEmployees("51-200")).toBe(126);
    expect(parseEmployees("1,001 to 5,000")).toBe(3001);
    expect(parseEmployees("10001+")).toBe(10001);
    expect(parseEmployees("many")).toBeUndefined();
  });
});

describe("parsers", () => {
  it("reads the company block of thecompaniesapi, including a nested country code", () => {
    const f = PROVIDERS.company.parse({ company: { name: "Acme", industryMain: "Software", totalEmployees: 180, locations: [{ country: { code: "US" } }] } });
    expect(f.company).toMatchObject({ industry: "Software", employees: 180, country: "US" });
  });
  it("reads a person's title and infers seniority from it", () => {
    const f = PROVIDERS.person_by_email.parse({ data: { person: { job_title: "VP of Sales" }, company: { industry: "SaaS", employees: "51-200" } } });
    expect(f.person).toMatchObject({ title: "VP of Sales", seniority: "vp", titleFrom: "quickenrich" });
    expect(f.company).toMatchObject({ industry: "SaaS", employees: 126 });
  });
  it("prefers the seniority a provider states over the title guess", () => {
    const f = PROVIDERS.person_by_name.parse({ lead: { title: "Lead Engineer", seniority: "Director" } });
    expect(f.person?.seniority).toBe("director");
  });
  it("reads technology names from the JSON:API included block", () => {
    const f = PROVIDERS.tech.parse({ data: [{ relationships: { technology: { data: { id: "t1" } } } }], included: [{ id: "t1", attributes: { name: "HubSpot" } }] });
    expect(f.company?.technologies).toEqual(["HubSpot"]);
  });
  it("returns nothing for bodies it does not recognise", () => {
    for (const p of Object.values(PROVIDERS)) expect(() => p.parse(null)).not.toThrow();
    expect(PROVIDERS.company.parse({ x: 1 }).company).toEqual({});
  });
  it("sends the fields each endpoint documents", () => {
    expect(inputFor("person_by_email", { email: "a@b.example" })).toEqual({ email: "a@b.example" });
    expect(inputFor("person_by_name", { firstName: "A", lastName: "B", domain: "b.example" })).toEqual({ first_name: "A", last_name: "B", domain: "b.example" });
    expect(inputFor("company", { domain: "b.example" })).toEqual({ email: "info@b.example" });
    expect(inputFor("tech", { domain: "b.example" })).toMatchObject({ company_id_or_domain: "b.example" });
  });
});

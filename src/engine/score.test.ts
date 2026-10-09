import { describe, expect, it } from "vitest";
import { loadIcp, parseIcp } from "./icp";
import { countryCode, distribution, hasTerm, scoreAll, scoreProfile } from "./score";
import type { Profile } from "./types";

const icp = loadIcp();
const profile = (over: Partial<Profile> & { lead?: Profile["lead"] } = {}): Profile => ({
  lead: { id: "L1", email: "a@acme.example", domain: "acme.com" },
  person: { title: "VP of Sales", seniority: "vp", titleFrom: "quickenrich" },
  company: { industry: "Software", employees: 200, country: "United States", technologies: ["HubSpot"], from: { industry: "thecompaniesapi", employees: "thecompaniesapi", country: "thecompaniesapi", technologies: "predictleads" } },
  calls: [],
  costMicros: 0,
  ...over,
});

describe("scoreProfile", () => {
  it("gives 100 and grade A to a lead that fits every part of the ICP, and names the provider of each fact", () => {
    const s = scoreProfile(profile(), icp);
    expect(s.score).toBe(100);
    expect(s.grade).toBe("A");
    expect(s.reasons.map((r) => r.provider)).toEqual(["thecompaniesapi", "thecompaniesapi", "thecompaniesapi", "quickenrich", "quickenrich", "predictleads"]);
    expect(s.reasons.reduce((n, r) => n + r.points, 0)).toBeCloseTo(100);
  });
  it("gives half the size points outside the ideal range and none outside the acceptable one", () => {
    const at = (employees: number) => scoreProfile(profile({ company: { ...profile().company, employees } }), icp).reasons.find((r) => r.component === "employees")!.points;
    expect(at(50)).toBe(25);
    expect(at(500)).toBe(25);
    expect(at(30)).toBe(12.5);
    expect(at(2000)).toBe(12.5);
    expect(at(10)).toBe(0);
    expect(at(5000)).toBe(0);
  });
  it("earns nothing for a missing fact, marks it unknown and does not guess", () => {
    const s = scoreProfile(profile({ company: { from: {} } }), icp);
    const sizes = s.reasons.find((r) => r.component === "employees")!;
    expect(sizes).toMatchObject({ known: false, points: 0, provider: null });
    expect(sizes.detail).toContain("No provider returned");
    expect(s.coverage).toEqual({ known: 2, active: 6 });
    expect(s.score).toBe(35);
  });
  it("matches whole words, so 'Salesforce Admin' does not match 'sales'", () => {
    expect(hasTerm("Salesforce Admin", ["sales"])).toBeUndefined();
    expect(hasTerm("Head of Sales", ["sales"])).toBe("sales");
  });
  it("matches countries by name or code", () => {
    expect(countryCode("United States")).toBe("us");
    const s = scoreProfile(profile({ company: { ...profile().company, country: "us" } }), icp);
    expect(s.reasons.find((r) => r.component === "geography")!.points).toBe(10);
    const off = scoreProfile(profile({ company: { ...profile().company, country: "AU" } }), icp);
    expect(off.reasons.find((r) => r.component === "geography")!.points).toBe(0);
  });
  it("caps the grade at D on a disqualifying industry and says why, whatever the score", () => {
    const s = scoreProfile(profile({ company: { ...profile().company, industry: "Government Administration software" } }), icp);
    expect(s.disqualified).toContain("Government");
    expect(s.grade).toBe("D");
  });
  it("caps the grade at D for a personal email with no company domain", () => {
    const s = scoreProfile(profile({ lead: { id: "L2", email: "me@gmail.com" } }), icp);
    expect(s.disqualified).toContain("Personal email");
    expect(s.grade).toBe("D");
    expect(scoreProfile(profile({ lead: { id: "L3", email: "me@gmail.com", domain: "acme.com" } }), icp).disqualified).toBeNull();
  });
  it("drops a component from the denominator when its criteria are empty", () => {
    const off = structuredClone(icp);
    off.components.tech.include = [];
    const s = scoreProfile(profile({ company: { ...profile().company, technologies: undefined } }), off);
    expect(s.coverage.active).toBe(5);
    expect(s.score).toBe(100);
  });
  it("scores a tech exclusion as zero", () => {
    const bad = structuredClone(icp);
    bad.components.tech.exclude = ["Marketo"];
    const s = scoreProfile(profile({ company: { ...profile().company, technologies: ["HubSpot", "Marketo"] } }), bad);
    expect(s.reasons.find((r) => r.component === "tech")!.points).toBe(0);
  });
  it("re-scores the same profile under a new ICP without any call", () => {
    const p = profile();
    const strict = structuredClone(icp);
    strict.components.employees.ideal = [1000, 2000];
    strict.components.employees.acceptable = [900, 3000];
    expect(scoreProfile(p, icp).score).toBeGreaterThan(scoreProfile(p, strict).score);
  });
  it("uses the grade thresholds from the ICP", () => {
    const p = profile({ company: { from: {} } }); // 35
    expect(scoreProfile(p, icp).grade).toBe("C");
    const harsh = structuredClone(icp);
    harsh.grades = { A: 90, B: 80, C: 50 };
    expect(scoreProfile(p, harsh).grade).toBe("D");
  });
  it("is deterministic and sorts best first", () => {
    const ps = [profile({ lead: { id: "L1", email: "a@x.example", domain: "x.com" }, company: { from: {} } }), profile({ lead: { id: "L2", email: "b@x.example", domain: "x.com" } })];
    const a = scoreAll(ps, icp);
    expect(a.map((s) => s.lead.id)).toEqual(["L2", "L1"]);
    expect(scoreAll(ps, icp)).toEqual(a);
    expect(distribution(a)).toEqual({ A: 1, B: 0, C: 1, D: 0 });
  });
});

describe("parseIcp", () => {
  it("names the field that is wrong", () => {
    const bad = structuredClone(icp) as unknown as { grades: { A: number } };
    bad.grades.A = 120;
    expect(() => parseIcp(bad)).toThrow(/grades\.A/);
  });
  it("rejects grade thresholds out of order and an ideal range outside the acceptable one", () => {
    const g = structuredClone(icp);
    g.grades = { A: 40, B: 60, C: 20 };
    expect(() => parseIcp(g)).toThrow(/A >= B >= C/);
    const e = structuredClone(icp);
    e.components.employees.ideal = [1, 5000];
    expect(() => parseIcp(e)).toThrow(/ideal must sit inside/);
  });
});

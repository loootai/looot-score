import { describe, expect, it } from "vitest";
import { emailDomain, normalizeDomain, parseCsv, parseLeads } from "./leads";

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, embedded commas and newlines, CRLF and a BOM", () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n"line\nbreak",z\r\n');
    expect(rows).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["line\nbreak", "z"]]);
  });
});

describe("normalizeDomain and emailDomain", () => {
  it("strips scheme, www and path and rejects non-domains", () => {
    expect(normalizeDomain("https://www.Acme.com/about")).toBe("acme.com");
    expect(normalizeDomain("acme")).toBeNull();
    expect(emailDomain("Jo@acme.example")).toBe("acme.example");
    expect(emailDomain("nope")).toBeNull();
  });
});

describe("parseLeads", () => {
  it("reads company rows that have only a domain and drops duplicates", () => {
    const { leads, rejected } = parseLeads("domain,company\nhttps://www.clay.com/,Clay\nclay.com,Clay again\nnot a domain,x\n");
    expect(leads).toEqual([{ id: "L1", email: undefined, firstName: undefined, lastName: undefined, domain: "clay.com", company: "Clay" }]);
    expect(rejected).toHaveLength(2);
  });
  it("reads email leads and takes the company domain from a work email", () => {
    const { leads, columns } = parseLeads("Work Email,Company\nJo.Smith@acme.example,Acme\n");
    expect(leads).toEqual([{ id: "L1", email: "jo.smith@acme.example", firstName: undefined, lastName: undefined, domain: "acme.example", company: "Acme" }]);
    expect(columns.email).toBe("Work Email");
  });
  it("reads name and domain leads and splits a full name", () => {
    const { leads } = parseLeads("name,website\nAda Lovelace,https://www.analytical.example/\nCher,x.example\n");
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ firstName: "Ada", lastName: "Lovelace", domain: "analytical.example" });
  });
  it("gives a personal mailbox no company domain unless the CSV has one", () => {
    const { leads } = parseLeads("email,domain\nx@gmail.com,\ny@gmail.com,acme.com\n");
    expect(leads[0].domain).toBeUndefined();
    expect(leads[1].domain).toBe("acme.com");
  });
  it("skips bad rows, duplicates and says why", () => {
    const { leads, rejected } = parseLeads("email,first_name,last_name,domain\nnot-an-email,,,\na@acme.example,,,\nA@acme.example,,,\n,Solo,,acme.com\n");
    expect(leads.map((l) => l.email)).toEqual(["a@acme.example"]);
    expect(rejected).toHaveLength(3);
    expect(rejected.join(" ")).toMatch(/not an email|duplicate|needs an email/);
  });
  it("throws a readable error when no usable column exists", () => {
    expect(() => parseLeads("foo,bar\n1,2\n")).toThrow(/needs an email column/);
  });
});

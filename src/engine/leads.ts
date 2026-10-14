import type { Lead } from "./types";

/** Mailbox providers. A lead on one of these has no company domain in the email. */
export const PERSONAL_EMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.net", "mail.com", "yandex.com", "hey.com", "fastmail.com", "zoho.com"]);

/** Lower-cases a domain and strips scheme, path and "www.". null when it is not a domain. */
export function normalizeDomain(input: string | undefined): string | null {
  if (!input) return null;
  const d = input.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0].replace(/:\d+$/, "");
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d) ? d : null;
}

/** The part after @ when the text is an email address, else null. */
export function emailDomain(email: string | undefined): string | null {
  if (!email) return null;
  const m = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(email.trim());
  return m ? m[1].toLowerCase() : null;
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIASES: Record<string, string[]> = {
  email: ["email", "workemail", "emailaddress", "businessemail"],
  first: ["firstname", "first", "givenname"],
  last: ["lastname", "last", "surname", "familyname"],
  full: ["name", "fullname", "contactname", "contact"],
  domain: ["domain", "companydomain", "website", "companywebsite", "url", "companyurl"],
  company: ["company", "companyname", "organization", "organisation", "account"],
};

export interface ParsedLeads {
  leads: Lead[];
  /** Rows that were skipped and why. */
  rejected: string[];
  /** Which input column each field was read from. */
  columns: Partial<Record<keyof typeof ALIASES, string>>;
}

/** Reads leads from CSV text. A row needs a valid email, or a name and a company domain, or a company domain alone (a company row, no person call). Duplicates are dropped. */
export function parseLeads(text: string): ParsedLeads {
  const rows = parseCsv(text);
  const rejected: string[] = [];
  if (rows.length === 0) return { leads: [], rejected, columns: {} };
  const head = rows[0].map(norm);
  const col: Record<string, number> = {};
  const columns: ParsedLeads["columns"] = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const i = head.findIndex((h) => names.includes(h));
    if (i >= 0) {
      col[field] = i;
      columns[field as keyof typeof ALIASES] = rows[0][i].trim();
    }
  }
  if (col.email === undefined && col.domain === undefined) {
    throw new Error(`The CSV needs an email column, a domain column (with name columns for people), or a domain column alone for company rows. Found: ${rows[0].join(", ")}`);
  }
  const get = (r: string[], f: string) => (col[f] === undefined ? undefined : r[col[f]]?.trim() || undefined);
  const seen = new Set<string>();
  const leads: Lead[] = [];
  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const rawEmail = get(r, "email")?.toLowerCase();
    const email = rawEmail && emailDomain(rawEmail) ? rawEmail : undefined;
    let first = get(r, "first");
    let last = get(r, "last");
    const full = get(r, "full");
    if (!first && !last && full) {
      const parts = full.split(/\s+/);
      first = parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0];
      last = parts.length > 1 ? parts[parts.length - 1] : undefined;
    }
    const given = normalizeDomain(get(r, "domain"));
    const fromEmail = email ? emailDomain(email) : null;
    const domain = given ?? (fromEmail && !PERSONAL_EMAIL_DOMAINS.has(fromEmail) ? fromEmail : null);
    if (rawEmail && !email && !(first && domain)) return void rejected.push(`line ${line}: "${rawEmail}" is not an email address`);
    const companyOnly = !email && !rawEmail && !first && !last && !!domain;
    if (!email && !companyOnly && !(first && last && domain)) return void rejected.push(`line ${line}: needs an email, or a first and last name and a domain, or a domain alone`);
    const key = email ?? (companyOnly ? `domain:${domain}` : `${first} ${last}@${domain}`.toLowerCase());
    if (seen.has(key)) return void rejected.push(`line ${line}: duplicate of an earlier row`);
    seen.add(key);
    leads.push({ id: `L${leads.length + 1}`, email, firstName: first, lastName: last, domain: domain ?? undefined, company: get(r, "company") });
  });
  return { leads, rejected, columns };
}

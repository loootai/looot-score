export type Grade = "A" | "B" | "C" | "D";
export type Seniority = "c_suite" | "vp" | "head" | "director" | "manager" | "senior" | "entry";
export type ComponentId = "employees" | "industry" | "geography" | "title" | "seniority" | "tech";

/** One row of the input CSV, normalised. A lead has an email, or a name and a domain. */
export interface Lead {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  /** Domain of the lead's company: from the CSV, else from a work email. */
  domain?: string;
  company?: string;
}

export interface PersonFacts {
  title?: string;
  seniority?: Seniority;
  /** Where each fact came from: provider name. */
  titleFrom?: string;
}

export interface CompanyFacts {
  industry?: string;
  employees?: number;
  country?: string;
  technologies?: string[];
  from: { industry?: string; employees?: string; country?: string; technologies?: string };
}

export type CallKind = "person_by_email" | "person_by_name" | "company" | "tech";
export type CallStatus = "ok" | "failed" | "pending" | "skipped_cap" | "skipped_price" | "parse_error";

/** One looot call made for a lead. Calls shared by several leads (same company) are paid once. */
export interface CallRecord {
  kind: CallKind;
  provider: string;
  endpointId: string;
  status: CallStatus;
  /** What looot charged for this call. 0 on the leads that only reuse it. */
  costMicros: number;
  listPriceMicros: number;
  /** true when another lead of the same company paid for this call. */
  shared: boolean;
  runId?: string;
  errorCode?: string;
  message?: string;
}

/** What looot returned for one lead. Enrichment is stored, so changing the ICP re-scores at no cost. */
export interface Profile {
  lead: Lead;
  person: PersonFacts;
  company: CompanyFacts;
  calls: CallRecord[];
  costMicros: number;
}

export interface ReasonLine {
  component: ComponentId;
  label: string;
  points: number;
  max: number;
  /** false when no provider returned the fact. The component then earns nothing. */
  known: boolean;
  detail: string;
  /** Provider that supplied the fact, if any. */
  provider: string | null;
}

export interface LeadScore {
  lead: Lead;
  score: number;
  grade: Grade;
  /** Set when a hard rule capped the grade at D. */
  disqualified: string | null;
  reasons: ReasonLine[];
  /** Components with data over components in the ICP. */
  coverage: { known: number; active: number };
  costMicros: number;
  pending: boolean;
}

export interface QuoteLine {
  kind: CallKind;
  label: string;
  provider: string;
  jobId: string;
  endpointId: string;
  calls: number;
  priceMicros: number;
  totalMicros: number;
}

export interface Quote {
  lines: QuoteLine[];
  leads: number;
  totalMicros: number;
  priceSource: "catalog" | "fallback";
}

export interface EnrichRun {
  runId: string;
  startedAt: string;
  finishedAt: string;
  demo: boolean;
  capMicros: number;
  quotedMicros: number;
  spentMicros: number;
  skippedByCap: number;
  pendingCalls: number;
  failedCalls: number;
  aborted: string | null;
  quote: Quote;
  profiles: Profile[];
  rejected: string[];
}

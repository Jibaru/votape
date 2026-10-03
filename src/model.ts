// The published data contract. Every JSON file under data/ matches one of
// these shapes, and `votape schema` describes them to agents. Changing a field
// here is a breaking change for anyone parsing our output: bump SCHEMA_VERSION.

export const SCHEMA_VERSION = "1.2.0";

export type Evidence = "declarado" | "registro_oficial" | "agregador" | "prensa";
export type LegalStatus = "sentencia" | "proceso" | "investigacion" | "denuncia" | "n/a";
export type FactCategory =
  | "criminal_sentence"
  | "civil_obligation"
  | "marginal_note"
  | "judicial_process"
  | "sanction"
  | "state_contract"
  | "traffic"
  | "reinfo"
  | "registered_debt"
  | "company_link"
  | "press_report";

export type Provider = {
  id: string;
  name: string;
  publisher: string;
  kind: "oficial" | "agregador" | "prensa";
  access: "api" | "html" | "manual";
  url: string;
  license: string;
  permission: "n/a" | "pending" | "granted" | "denied";
  methodologyUrl?: string;
  notes?: string;
  /** Press outlets: the only domains a press fact may cite. */
  domains?: string[];
};

export type Source = {
  id: string;
  providerId: string;
  url: string;
  archivedUrl?: string;
  /** sha256 of the raw response as fetched; the raw file itself is not published. */
  sha256?: string;
  accessedAt: string;
  publisher: string;
  title?: string;
  extractedBy: "api" | "scraper" | "agent" | "manual";
};

/**
 * Facts that do not come from the JNE ingest (press, aggregators, manual
 * lookups) live apart from the candidate file, so re-running the JNE ingest
 * never drops a reviewed fact. Only reviewed facts are ever written here.
 */
export type ExtraFacts = { candidateId: string; facts: Fact[]; sources: Source[] };

export type Fact = {
  id: string;
  category: FactCategory;
  summary: string;
  evidence: Evidence;
  legalStatus: LegalStatus;
  date?: string;
  details: Record<string, string | null>;
  /** Verbatim text from the source backing this fact. */
  quote?: string;
  /** Checked at queue time: the quote appears in the fetched page. */
  quoteVerified?: boolean;
  /** Why the source is about this candidate and not a namesake. */
  identityEvidence?: string;
  sourceIds: string[];
  needsReview: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
  supersededBy?: string;
};

export type StatusChange = { status: string; observedAt: string; sourceId: string };

export type Candidate = {
  id: string;
  slug: string;
  electionId: string;
  name: string;
  givenNames: string;
  surnames: string;
  age: number | null;
  gender: string | null;
  party: { id: number; name: string };
  jurisdictionId: string;
  office: string;
  status: string;
  statusHistory: StatusChange[];
  education: {
    basic: { primary: boolean; secondary: boolean } | null;
    entries: {
      level: "tecnico" | "no_universitaria" | "universitaria" | "posgrado" | "posgrado_otro";
      institution: string;
      program: string;
      completed: boolean | null;
      degree: string | null;
      year: string | null;
    }[];
  };
  work: { employer: string; role: string; from: string | null; to: string | null }[];
  publicOffices: { office: string; party: string; from: string | null; to: string | null }[];
  partyPositions: { position: string; party: string; from: string | null; to: string | null }[];
  partyResignations: { party: string; year: string | null }[];
  assets: {
    income: { year: string | null; total: number; public: number; private: number }[];
    realEstate: { type: string; value: number | null; registeredInSunarp: boolean }[];
    vehicles: { type: string; value: number | null }[];
    otherMovable: { type: string; value: number | null }[];
    holdings: { company: string; type: string; quantity: number | null; value: number | null }[];
  };
  additionalInfo: string[];
  plan: {
    pdfUrl: string | null;
    summaryPdfUrl: string | null;
    dimensions: {
      name: string;
      items: { problem: string; objective: string; goal: string; indicator: string }[];
    }[];
  };
  facts: Fact[];
  sources: Source[];
  result?: { votes: number; share: number; elected: boolean; sourceId: string };
};

export type Candidacy = {
  candidateId: string | null;
  name: string | null;
  party: { id: number; name: string };
  office: string;
  status: string;
  listId: number;
  expediente: string;
};

export type Jurisdiction = {
  id: string;
  name: string;
  level: "provincial" | "distrital";
  parentId: string | null;
  electionId: string;
  candidacies: Candidacy[];
};

export type Election = {
  id: string;
  name: string;
  date: string;
  rounds: string;
  scope: string;
  offices: string[];
  jurisdictionIds: string[];
  snapshotAt: string;
  coverage: { providerId: string; status: "complete" | "partial" | "pending"; note: string }[];
};

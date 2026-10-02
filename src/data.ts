// Loads the bundled dataset. The CLI never touches the network: everything it
// answers comes from data/ as shipped in the package.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candidate, Election, ExtraFacts, Fact, Jurisdiction, Provider } from "./model.js";

// src/cli.ts and dist/cli.js both sit one level below the package root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

export type Dataset = {
  elections: Election[];
  jurisdictions: Map<string, Jurisdiction>;
  candidates: Map<string, Candidate>;
  providers: Provider[];
};

let cached: Dataset | null = null;

export function load(): Dataset {
  if (cached) return cached;
  const electionsDir = join(DATA, "elections");
  const elections: Election[] = [];
  const jurisdictions = new Map<string, Jurisdiction>();
  const candidates = new Map<string, Candidate>();
  for (const id of existsSync(electionsDir) ? readdirSync(electionsDir) : []) {
    const dir = join(electionsDir, id);
    if (!existsSync(join(dir, "election.json"))) continue;
    elections.push(readJson<Election>(join(dir, "election.json")));
    for (const f of readdirSync(join(dir, "jurisdictions"))) {
      const j = readJson<Jurisdiction>(join(dir, "jurisdictions", f));
      jurisdictions.set(`${j.electionId}:${j.id}`, j);
    }
    for (const f of readdirSync(join(dir, "candidates"))) {
      const c = readJson<Candidate>(join(dir, "candidates", f));
      candidates.set(c.id, c);
    }
    // Reviewed facts from outside the JNE ingest (press, aggregators).
    const factsDir = join(dir, "facts");
    for (const f of existsSync(factsDir) ? readdirSync(factsDir) : []) {
      const extra = readJson<ExtraFacts>(join(factsDir, f));
      const c = candidates.get(extra.candidateId);
      if (!c) continue;
      c.facts.push(...extra.facts);
      c.sources.push(...extra.sources);
    }
  }
  elections.sort((a, b) => b.date.localeCompare(a.date));
  const catalog = join(DATA, "sources", "catalog.json");
  const providers = existsSync(catalog) ? readJson<Provider[]>(catalog) : [];
  cached = { elections, jurisdictions, candidates, providers };
  return cached;
}

/** Lowercase, accent-free, single-spaced. The key every lookup compares on. */
export const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function jurisdictionOf(ds: Dataset, c: Candidate): Jurisdiction | undefined {
  return ds.jurisdictions.get(`${c.electionId}:${c.jurisdictionId}`);
}

/** Facts that are published: reviewed or not needing review, and not superseded. */
export const visibleFacts = (c: Candidate): Fact[] =>
  c.facts.filter((f) => !f.needsReview && !f.supersededBy);

export type CandidateSummary = {
  id: string;
  slug: string;
  name: string;
  age: number | null;
  party: string;
  jurisdiction: { id: string; name: string };
  office: string;
  status: string;
  facts: Record<string, number>;
};

export function summarize(ds: Dataset, c: Candidate): CandidateSummary {
  const facts: Record<string, number> = {};
  for (const f of visibleFacts(c)) facts[f.category] = (facts[f.category] ?? 0) + 1;
  const j = jurisdictionOf(ds, c);
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    age: c.age,
    party: c.party.name,
    jurisdiction: { id: c.jurisdictionId, name: j?.name ?? c.jurisdictionId },
    office: c.office,
    status: c.status,
    facts,
  };
}

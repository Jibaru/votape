// RTC ingest, stage 2: turn the visible text of each browsed profile into
// `agregador` facts, one file per candidate under facts/<id>.rtc.json.
//
// Each profile tab is split into RTC's own sections ("Deudas alimentarias",
// "Sanciones OECE", ...). A section that says "No registra" / "No figura"
// yields nothing; any other section yields a fact quoting what RTC showed,
// with RTC and the original registry as publisher.
//
// Privacy, on top of the JNE rules: a natural person's RUC (10 + DNI + check
// digit) embeds the DNI, so it is redacted; traffic records are reduced to
// counts and license status (papeletas can carry plates).
//
// Usage: bun run scripts/ingest/rtc-normalize.ts

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtraFacts, Fact, FactCategory, LegalStatus, Source } from "../../src/model.js";
import type { RtcProfile } from "./rtc-browse.js";

const ROOT = join(import.meta.dir, "../..");
const PROFILES = join(ROOT, ".cache/rtc/profiles");
const FACTS = join(ROOT, "data/elections/erm-2026/facts");

type Section = {
  tab: string;
  heading: string;
  category: FactCategory;
  registry: string;
  legalStatus: LegalStatus;
  label: string;
};

// The sections we publish, in RTC's words. Sentences are left out on purpose:
// RTC takes them from the JNE CV, which votape already carries first-hand.
const SECTIONS: Section[] = [
  { tab: "Contratos con el Estado", heading: "Contratos con el Estado", category: "state_contract", registry: "OECE", legalStatus: "n/a", label: "Contratos con el Estado" },
  { tab: "Contratos con el Estado", heading: "Empresas vinculadas", category: "company_link", registry: "SUNAT y OECE", legalStatus: "n/a", label: "Empresas vinculadas" },
  { tab: "Contratos con el Estado", heading: "Derechos Mineros", category: "reinfo", registry: "REINFO", legalStatus: "n/a", label: "Derechos mineros en el REINFO" },
  { tab: "Deudas y obligaciones", heading: "Deudas alimentarias", category: "registered_debt", registry: "REDAM", legalStatus: "n/a", label: "Registro de Deudores Alimentarios Morosos (REDAM)" },
  { tab: "Deudas y obligaciones", heading: "Deudas judiciales", category: "registered_debt", registry: "REDJUM", legalStatus: "n/a", label: "Registro de Deudores Judiciales Morosos (REDJUM)" },
  { tab: "Sanciones", heading: "Sanciones a abogados", category: "sanction", registry: "RNAS", legalStatus: "n/a", label: "Sanción como abogado (RNAS)" },
  { tab: "Sanciones", heading: "Sanciones a servidores civiles", category: "sanction", registry: "RNSSC-SERVIR", legalStatus: "n/a", label: "Sanción como servidor civil (RNSSC-SERVIR)" },
  { tab: "Sanciones", heading: "Sanciones OECE", category: "sanction", registry: "OECE", legalStatus: "n/a", label: "Sanción del OECE" },
];

// Every heading RTC uses inside these tabs, so a section ends where the next begins.
const ALL_HEADINGS = [
  "Información SUNAT",
  "Contratos con el Estado",
  "Empresas vinculadas",
  "Derechos Mineros",
  "Deudas alimentarias",
  "Deudas judiciales",
  "Infracciones de tránsito",
  "Sentencias judiciales",
  "Sanciones a abogados",
  "Sanciones a servidores civiles",
  "Sanciones OECE",
  "Historial Electoral",
  "Historial de Afiliación",
];

const NEGATIVE = /^(No registra|No figura|Sin registros|No tiene)/im;
const redact = (s: string) =>
  s
    .replace(/\b10\d{9}\b/g, "[RUC de persona natural omitido]")
    .replace(/\bDNI:?\s*\d{8}\b/gi, "DNI [omitido]")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

function section(text: string, heading: string): string | null {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => ALL_HEADINGS.includes(l.trim()));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}

const firstNumber = (s: string) => Number(s.match(/^\((\d+)\)/m)?.[1] ?? Number.NaN);

function trafficFact(p: RtcProfile, src: Source): Fact | null {
  const body = section(p.tabs["Deudas y obligaciones"]?.text ?? "", "Infracciones de tránsito");
  if (!body) return null;
  const grab = (re: RegExp) => body.match(re)?.[1]?.trim() ?? null;
  const grave = Number(grab(/Faltas graves:\s*(\d+)/) ?? 0);
  const muyGrave = Number(grab(/Faltas muy graves:\s*(\d+)/) ?? 0);
  const papeletas = Number(grab(/Papeletas:\s*(\d+)/) ?? 0);
  const puntos = Number(grab(/Puntos acumulados:\s*(\d+)/) ?? 0);
  const licencia = grab(/Licencia\s+([^\n]+)/);
  // Expired or absent licenses are not antecedents; suspension and cancellation are.
  const licenseProblem = Boolean(licencia && /suspend|cancel|inhabilit/i.test(licencia));
  // Only very serious faults (they include drunk driving) and license problems:
  // a single "grave" fault (e.g. no seatbelt) is noise, not an antecedent.
  if (!muyGrave && !licenseProblem) return null;
  const parts = [muyGrave ? `${muyGrave} falta(s) muy grave(s)` : "", grave ? `${grave} falta(s) grave(s)` : "", licenseProblem ? `licencia: ${licencia}` : ""].filter(Boolean);
  return {
    id: `rtc-${p.rtcId}-transito`,
    category: "traffic",
    summary: `Según RTC (datos del MTC): ${parts.join(", ")}.`,
    evidence: "agregador",
    legalStatus: "n/a",
    details: {
      registro: "MTC (SLCP y SCPPP)",
      faltasGraves: String(grave),
      faltasMuyGraves: String(muyGrave),
      papeletas: String(papeletas),
      puntosAcumulados: String(puntos),
      licencia,
    },
    quote: parts.join(" · "),
    sourceIds: [src.id],
    needsReview: false,
  };
}

function profileFacts(p: RtcProfile): ExtraFacts {
  const facts: Fact[] = [];
  const sources: Source[] = [];
  const sourceFor = (tab: string): Source => {
    const id = `rtc-${p.rtcId}-${tab.toLowerCase().normalize("NFD").replace(/[^a-z]+/g, "-")}`;
    let s = sources.find((x) => x.id === id);
    if (!s) {
      s = {
        id,
        providerId: "rtc",
        url: p.profileUrl,
        sha256: p.tabs[tab]?.sha256,
        accessedAt: p.fetchedAt,
        publisher: "Revisa Tu Candidato (Consorcio RTC)",
        title: `Ficha del candidato · pestaña "${tab}" (captura en el archivo privado de votape)`,
        extractedBy: "scraper",
      };
      sources.push(s);
    }
    return s;
  };

  for (const sec of SECTIONS) {
    const body = section(p.tabs[sec.tab]?.text ?? "", sec.heading);
    if (!body || NEGATIVE.test(body)) continue;
    const count = firstNumber(body);
    if (count === 0) continue;
    const clean = redact(body.replace(/^\(\d+\)\n?/, "").replace(/^Fuente:[^\n]*\n?/m, "").replace(/^Empresas donde figura[^\n]*\n?/m, ""));
    if (!clean) continue;
    const total = sec.category === "state_contract" ? clean.match(/^\d+ contratos?\nS\/ ([\d,.]+)/m)?.[1] : undefined;
    const n = Number.isNaN(count) ? null : count;
    const vigente = /\bVIGENTE\b/.test(clean) ? " (al menos una vigente)" : "";
    const summary =
      sec.category === "state_contract"
        ? `Según RTC (datos del OECE): ${n ?? "registra"} contrato(s) con el Estado${total ? ` por S/ ${total}` : ""}.`
        : sec.category === "company_link"
          ? `Según RTC (datos de SUNAT y OECE): figura como accionista, administrador o representante de ${n ?? "una o más"} empresa(s).`
          : sec.category === "sanction"
            ? `Según RTC: registra ${n === null ? "sanciones" : `${n} sanción(es)`} en el registro ${sec.registry}${vigente}.`
            : sec.category === "reinfo"
              ? `Según RTC: registra ${n ?? "al menos un"} derecho(s) minero(s) en el REINFO.`
              : `Según RTC: figura en el ${sec.label}.`;
    facts.push({
      id: `rtc-${p.rtcId}-${sec.registry.toLowerCase().replace(/[^a-z]+/g, "-")}-${sec.category}`,
      category: sec.category,
      summary,
      evidence: "agregador",
      legalStatus: sec.legalStatus,
      details: { registro: sec.registry, ...(Number.isNaN(count) ? {} : { cantidad: String(count) }), ...(total ? { montoTotal: `S/ ${total}` } : {}) },
      quote: clean.slice(0, 600),
      sourceIds: [sourceFor(sec.tab).id],
      needsReview: false,
    });
  }

  // SUNAT coactive debt lives inside the "Información SUNAT" block.
  const sunat = section(p.tabs["Contratos con el Estado"]?.text ?? "", "Información SUNAT");
  if (sunat && /coactiva/i.test(sunat) && !/(sin|no registra|no tiene)[^\n]*coactiva/i.test(sunat)) {
    facts.push({
      id: `rtc-${p.rtcId}-sunat-coactiva`,
      category: "registered_debt",
      summary: "Según RTC (datos de SUNAT): registra deuda en cobranza coactiva.",
      evidence: "agregador",
      legalStatus: "n/a",
      details: { registro: "SUNAT" },
      quote: redact(sunat).slice(0, 600),
      sourceIds: [sourceFor("Contratos con el Estado").id],
      needsReview: false,
    });
  }

  const traffic = trafficFact(p, sourceFor("Deudas y obligaciones"));
  if (traffic) facts.push(traffic);

  // Only keep the sources some fact cites.
  const used = new Set(facts.flatMap((f) => f.sourceIds));
  return { candidateId: p.candidateId, facts, sources: sources.filter((s) => used.has(s.id)) };
}

function main() {
  mkdirSync(FACTS, { recursive: true });
  for (const f of readdirSync(FACTS).filter((x) => x.endsWith(".rtc.json"))) rmSync(join(FACTS, f));
  let withFacts = 0;
  const byCategory: Record<string, number> = {};
  const files = existsSync(PROFILES) ? readdirSync(PROFILES) : [];
  for (const f of files) {
    const p = JSON.parse(readFileSync(join(PROFILES, f), "utf8")) as RtcProfile;
    const extra = profileFacts(p);
    if (!extra.facts.length) continue;
    withFacts++;
    for (const x of extra.facts) byCategory[x.category] = (byCategory[x.category] ?? 0) + 1;
    writeFileSync(join(FACTS, `${p.candidateId}.rtc.json`), `${JSON.stringify(extra, null, 2)}\n`);
  }
  process.stderr.write(`RTC normalizado: ${files.length} fichas, ${withFacts} con hallazgos ${JSON.stringify(byCategory)}\n`);
}

main();

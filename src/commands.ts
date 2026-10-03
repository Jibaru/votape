import {
  type CandidateSummary,
  type Dataset,
  fold,
  jurisdictionOf,
  summarize,
  visibleFacts,
} from "./data.js";
import type { Candidate, Candidacy, Election, Fact, FactCategory, Jurisdiction, Source } from "./model.js";
import { type Ctx, type NextStep, legalFooter, notFound, respond, safe, usage } from "./output.js";
import {
  bold,
  dim,
  info,
  muted,
  ok,
  padStartVisible,
  padVisible,
  strong,
  truncateVisible,
  underline,
  warn,
} from "./lib/platform/style.js";

export type Args = { _: string[]; [key: string]: unknown };

export const CATEGORY_LABEL: Record<FactCategory, string> = {
  criminal_sentence: "Sentencias penales",
  civil_obligation: "Sentencias por obligaciones",
  marginal_note: "Anotaciones marginales del JNE",
  judicial_process: "Procesos judiciales",
  sanction: "Sanciones",
  state_contract: "Contratos con el Estado",
  traffic: "Tránsito",
  reinfo: "REINFO (minería)",
  registered_debt: "Deudas en registros oficiales",
  company_link: "Empresas vinculadas",
  press_report: "Reportes de prensa",
};
const CATEGORY_SHORT: Partial<Record<FactCategory, string>> = {
  press_report: "prensa",
  judicial_process: "proceso",
  sanction: "sanción",
  state_contract: "contratos",
  registered_debt: "deuda",
  company_link: "empresas",
  traffic: "tránsito",
  reinfo: "reinfo",
  criminal_sentence: "penal",
  civil_obligation: "oblig.",
  marginal_note: "anot.",
};
const EVIDENCE_LABEL: Record<string, string> = {
  declarado: "declarado por el candidato",
  registro_oficial: "registro oficial",
  agregador: "agregador",
  prensa: "prensa",
};

const width = () => Math.max(60, Math.min(process.stdout.columns ?? 100, 140));
const money = (n: number | null) => (n === null ? "—" : `S/ ${Math.round(n).toLocaleString("es-PE")}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const statusStyle = (s: string) => (s === "INSCRITO" ? ok(cap(s)) : warn(cap(s)));
const section = (title: string) => `\n${bold(underline(title.toUpperCase()))}`;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const limitOf = (args: Args, dflt: number) => {
  const n = Number(args.limit ?? dflt);
  if (!Number.isInteger(n) || n < 1) throw usage("--limit debe ser un entero positivo.");
  return n;
};

// ---------------------------------------------------------------- resolution

export function pickElection(ds: Dataset, args: Args): Election {
  const id = str(args.election);
  if (!ds.elections.length) throw notFound("No hay datos de elecciones en este paquete.");
  if (!id) return ds.elections[0] as Election;
  const e = ds.elections.find((x) => x.id === id);
  if (!e) {
    throw notFound(`No existe la elección "${id}".`, `Disponibles: ${ds.elections.map((x) => x.id).join(", ")}`);
  }
  return e;
}

export function findJurisdiction(ds: Dataset, election: Election, query: string): Jurisdiction {
  const all = [...ds.jurisdictions.values()].filter((j) => j.electionId === election.id);
  const byId = all.find((j) => j.id === query);
  if (byId) return byId;
  const q = fold(query);
  const exact = all.filter((j) => fold(j.name) === q);
  if (exact.length === 1) return exact[0] as Jurisdiction;
  const partial = all.filter((j) => fold(j.name).includes(q));
  if (partial.length === 1) return partial[0] as Jurisdiction;
  if (partial.length > 1) {
    throw usage(
      `"${query}" coincide con varias circunscripciones: ${partial.map((j) => `${j.name} (${j.id})`).join(", ")}.`,
      "Usa el ubigeo o el nombre completo.",
    );
  }
  throw notFound(`No encontré la circunscripción "${query}".`, "Corre: votape jurisdiction list");
}

export function findCandidate(ds: Dataset, query: string): Candidate {
  const direct = ds.candidates.get(query);
  if (direct) return direct;
  const all = [...ds.candidates.values()];
  const bySlug = all.find((c) => c.slug === query);
  if (bySlug) return bySlug;
  const byPrefix = query.length >= 6 ? all.filter((c) => c.id.startsWith(query)) : [];
  if (byPrefix.length === 1) return byPrefix[0] as Candidate;
  const matches = searchCandidates(all, query);
  if (matches.length === 1) return matches[0] as Candidate;
  if (matches.length > 1) {
    throw usage(
      `"${query}" coincide con ${matches.length} candidatos.`,
      `Usa el id. Corre: votape candidate search "${query}"`,
    );
  }
  throw notFound(`No encontré al candidato "${query}".`, `Corre: votape candidate search "${query}"`);
}

/** Every query word must appear in the candidate's name, party or district. */
function searchCandidates(cands: Candidate[], query: string, ds?: Dataset): Candidate[] {
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  return cands.filter((c) => {
    const hay = fold(`${c.name} ${c.party.name} ${ds ? (jurisdictionOf(ds, c)?.name ?? "") : ""}`);
    return words.every((w) => hay.includes(w));
  });
}

// ---------------------------------------------------------------- tables

function factBadge(facts: Record<string, number>): string {
  const parts = Object.entries(facts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${CATEGORY_SHORT[k as FactCategory] ?? k}`);
  return parts.length ? parts.join(" · ") : muted("—");
}

function candidateTable(rows: CandidateSummary[], showJurisdiction: boolean): string {
  if (!rows.length) return muted("  (sin resultados)");
  const cols = showJurisdiction
    ? { name: 30, party: 26, jur: 18, status: 10 }
    : { name: 34, party: 32, jur: 0, status: 10 };
  const header = [
    padVisible(dim("Candidato"), cols.name),
    padVisible(dim("Organización política"), cols.party),
    showJurisdiction ? padVisible(dim("Circunscripción"), cols.jur) : "",
    padVisible(dim("Estado"), cols.status),
    dim("Antecedentes"),
  ]
    .filter(Boolean)
    .join("  ");
  const lines = rows.map((r) =>
    [
      padVisible(truncateVisible(strong(safe(r.name)), cols.name), cols.name),
      padVisible(truncateVisible(safe(r.party), cols.party), cols.party),
      showJurisdiction ? padVisible(truncateVisible(r.jurisdiction.name, cols.jur), cols.jur) : "",
      padVisible(statusStyle(r.status), cols.status),
      factBadge(r.facts),
    ]
      .filter(Boolean)
      .join("  "),
  );
  return [header, ...lines].map((l) => `  ${l}`).join("\n");
}

const legend = () =>
  legalFooter().slice(1) + "\n" + muted(
    "  penal / oblig. = sentencia penal o por obligación DECLARADA por el candidato en su hoja de vida del JNE · anot. = anotación marginal del JNE\n  prensa / proceso = hallazgos de prensa revisados por una persona · contratos / empresas / deuda / sanción / tránsito = registros oficiales vía RTC · detalle y fuentes: votape candidate get",
  );

// ---------------------------------------------------------------- candidate

export function candidateSearch(ds: Dataset, ctx: Ctx, args: Args): number {
  const query = args._.join(" ").trim();
  if (!query) throw usage("Falta el texto a buscar.", 'Ejemplo: votape candidate search "bruce"');
  const election = pickElection(ds, args);
  let pool = [...ds.candidates.values()].filter((c) => c.electionId === election.id);
  const jq = str(args.jurisdiction);
  if (jq) {
    const j = findJurisdiction(ds, election, jq);
    pool = pool.filter((c) => c.jurisdictionId === j.id);
  }
  const limit = limitOf(args, 20);
  const all = searchCandidates(pool, query, ds).map((c) => summarize(ds, c));
  const data = { query, total: all.length, results: all.slice(0, limit) };
  const first = data.results[0];
  const next: NextStep[] = first
    ? [{ command: `votape candidate get ${first.id}`, description: `Perfil completo de ${first.name}` }]
    : [{ command: "votape jurisdiction list", description: "Ver las circunscripciones disponibles" }];
  return respond(ctx, data, next, (d) =>
    [
      `\n  ${bold(`${d.total} resultado${d.total === 1 ? "" : "s"}`)} ${muted(`para "${safe(d.query)}"`)}\n`,
      candidateTable(d.results, true),
      d.total > d.results.length ? muted(`\n  … y ${d.total - d.results.length} más (usa --limit)`) : "",
      first ? `\n  ${muted("Siguiente:")} votape candidate get ${first.slug}` : "",
    ].join("\n"),
  );
}

export function candidateList(ds: Dataset, ctx: Ctx, args: Args): number {
  const election = pickElection(ds, args);
  let pool = [...ds.candidates.values()].filter((c) => c.electionId === election.id);
  const jq = str(args.jurisdiction) ?? args._[0];
  let jurisdiction: Jurisdiction | undefined;
  if (jq) {
    jurisdiction = findJurisdiction(ds, election, jq);
    pool = pool.filter((c) => c.jurisdictionId === jurisdiction?.id);
  }
  const status = str(args.status);
  if (status) pool = pool.filter((c) => fold(c.status) === fold(status));
  const hasFact = str(args.hasFact);
  if (hasFact) {
    if (!(hasFact in CATEGORY_LABEL)) {
      throw usage(`Categoría desconocida: ${hasFact}`, `Válidas: ${Object.keys(CATEGORY_LABEL).join(", ")}`);
    }
    pool = pool.filter((c) => visibleFacts(c).some((f) => f.category === hasFact));
  }
  const rows = pool
    .map((c) => summarize(ds, c))
    .sort((a, b) => a.jurisdiction.name.localeCompare(b.jurisdiction.name) || a.name.localeCompare(b.name));
  const limit = args.limit === undefined ? rows.length : limitOf(args, rows.length);
  const data = { total: rows.length, results: rows.slice(0, limit) };
  const next: NextStep[] = [
    { command: "votape candidate get <id>", description: "Perfil completo de un candidato" },
    ...(jurisdiction ? [] : [{ command: "votape candidate list --jurisdiction <nombre>", description: "Filtrar por distrito" }]),
  ];
  return respond(ctx, data, next, (d) => {
    if (!jurisdiction && !hasFact && !status && d.total > 40) {
      return [
        `\n  ${bold(`${d.total} candidatos`)} ${muted(`en ${election.name}`)}`,
        `\n  ${muted("Son muchos para una tabla. Prueba:")}`,
        "    votape jurisdiction list                 resumen por distrito",
        "    votape candidate list miraflores         candidatos de un distrito",
        "    votape candidate list --has-fact criminal_sentence",
        `    votape candidate list --json             ${muted("todo, para procesar")}`,
      ].join("\n");
    }
    const title = jurisdiction ? `${jurisdiction.name} · ${cap(jurisdiction.level === "provincial" ? "alcaldía provincial" : "alcaldía distrital")}` : election.name;
    return [`\n  ${bold(title)}  ${muted(`${d.total} candidatos`)}\n`, candidateTable(d.results, !jurisdiction), "", legend()].join("\n");
  });
}

export function candidateGet(ds: Dataset, ctx: Ctx, args: Args): number {
  const q = args._.join(" ").trim();
  if (!q) throw usage("Falta el id o nombre del candidato.", "Ejemplo: votape candidate get carlos-ricardo-bruce-montes-de-oca");
  const c = findCandidate(ds, q);
  const j = jurisdictionOf(ds, c);
  const election = ds.elections.find((e) => e.id === c.electionId);
  const pending = election?.coverage.filter((x) => x.status !== "complete") ?? [];
  const facts = visibleFacts(c);
  const data = {
    ...c,
    facts,
    jurisdiction: j ? { id: j.id, name: j.name, level: j.level } : null,
    coverage: election?.coverage ?? [],
  };
  const next: NextStep[] = [
    { command: `votape fact list --candidate ${c.id}`, description: "Solo los antecedentes, con sus fuentes" },
    ...(j ? [{ command: `votape jurisdiction get ${j.id}`, description: `Los demás candidatos de ${j.name}` }] : []),
  ];
  return respond(ctx, data, next, () => renderCandidate(c, j, facts, pending));
}

function renderCandidate(c: Candidate, j: Jurisdiction | undefined, facts: Fact[], pending: Election["coverage"]): string {
  const out: string[] = [];
  out.push(`\n  ${bold(strong(safe(c.name)))}`);
  out.push(`  ${safe(c.party.name)} · ${cap(c.office)} · ${j?.name ?? c.jurisdictionId}`);
  out.push(`  ${statusStyle(c.status)}${c.age !== null ? ` · ${c.age} años` : ""}${c.gender ? ` · ${c.gender}` : ""}`);

  out.push(section("Antecedentes declarados y registros"));
  const cats: FactCategory[] = ["criminal_sentence", "civil_obligation", "marginal_note"];
  for (const cat of [...cats, ...(Object.keys(CATEGORY_LABEL) as FactCategory[]).filter((k) => !cats.includes(k))]) {
    const list = facts.filter((f) => f.category === cat);
    if (!list.length && !cats.includes(cat)) continue;
    const none = cat === "marginal_note" ? "— ninguna" : "— ninguna declarada";
    out.push(`  ${bold(CATEGORY_LABEL[cat])} ${list.length ? `(${list.length})` : muted(none)}`);
    for (const f of list) out.push(renderFact(f, c.sources));
  }

  out.push(section("Educación"));
  const b = c.education.basic;
  if (b) out.push(`  ${muted("Básica:")} primaria ${b.primary ? "completa" : "incompleta"}, secundaria ${b.secondary ? "completa" : "incompleta"}`);
  const levelLabel = { tecnico: "Técnica", no_universitaria: "No universitaria", universitaria: "Universitaria", posgrado: "Posgrado", posgrado_otro: "Otros estudios" };
  for (const e of c.education.entries) {
    const tail = [e.degree, e.completed === false ? "no concluido" : null, e.year].filter(Boolean).join(", ");
    out.push(`  • ${padVisible(muted(levelLabel[e.level]), 17)} ${safe(e.program)} — ${safe(e.institution)}${tail ? muted(` (${tail})`) : ""}`);
  }
  if (!b && !c.education.entries.length) out.push(muted("  Sin información declarada"));

  out.push(section("Experiencia laboral"));
  for (const w of c.work.slice(0, 6)) out.push(`  • ${safe(w.role)} — ${safe(w.employer)} ${muted(`${w.from ?? "?"}–${w.to ?? "?"}`)}`);
  if (c.work.length > 6) out.push(muted(`  … y ${c.work.length - 6} más (usa --json)`));
  if (!c.work.length) out.push(muted("  Sin información declarada"));

  if (c.publicOffices.length || c.partyPositions.length || c.partyResignations.length) {
    out.push(section("Trayectoria política"));
    for (const p of c.publicOffices) out.push(`  • ${cap(p.office)} por ${safe(p.party)} ${muted(`${p.from ?? "?"}–${p.to ?? "?"}`)}`);
    for (const p of c.partyPositions) out.push(`  • ${cap(p.position)} en ${safe(p.party)} ${muted(`${p.from ?? "?"}–${p.to ?? "?"}`)}`);
    for (const r of c.partyResignations) out.push(`  • Renunció a ${safe(r.party)} ${muted(r.year ?? "")}`);
  }

  out.push(section("Declaración jurada de bienes e ingresos"));
  const inc = [...c.assets.income].sort((a, b) => (b.year ?? "").localeCompare(a.year ?? ""))[0];
  const sum = (xs: { value: number | null }[]) => xs.reduce((s, x) => s + (x.value ?? 0), 0);
  out.push(`  ${padVisible(muted("Ingresos"), 12)} ${inc ? `${money(inc.total)} ${muted(`(${inc.year ?? "año ?"}; público ${money(inc.public)}, privado ${money(inc.private)})`)}` : muted("no declarados")}`);
  out.push(`  ${padVisible(muted("Inmuebles"), 12)} ${c.assets.realEstate.length} ${muted(`· valor declarado ${money(sum(c.assets.realEstate))}`)}`);
  out.push(`  ${padVisible(muted("Vehículos"), 12)} ${c.assets.vehicles.length} ${muted(`· valor declarado ${money(sum(c.assets.vehicles))}`)}`);
  if (c.assets.holdings.length) out.push(`  ${padVisible(muted("Acciones"), 12)} ${c.assets.holdings.map((h) => safe(h.company)).join("; ")}`);

  if (c.additionalInfo.length) {
    out.push(section("Información adicional declarada"));
    for (const a of c.additionalInfo) out.push(`  ${safe(a)}`);
  }

  out.push(section("Plan de gobierno"));
  if (c.plan.pdfUrl) out.push(`  ${muted("PDF:")} ${info(c.plan.pdfUrl)}`);
  if (c.plan.dimensions.length) {
    out.push(`  ${muted("Resumen oficial del JNE:")} ${c.plan.dimensions.map((d) => `${d.name} (${d.items.length})`).join(" · ")}`);
    out.push(muted("  Detalle de problemas, objetivos y metas: usa --json"));
  }

  out.push(section("Fuentes"));
  for (const s of c.sources) out.push(`  [${s.id}] ${s.publisher} ${muted(`· consultado ${s.accessedAt.slice(0, 10)}`)}\n  ${info(s.url)}`);
  if (pending.length) {
    out.push("");
    for (const p of pending) {
      out.push(`  ${warn("⚠")} ${p.status === "partial" ? `Cobertura parcial de ${p.providerId}: ${p.note}` : p.note}`);
    }
  }
  out.push(legalFooter());
  return out.join("\n");
}

const LEGAL_LABEL: Record<string, string> = {
  sentencia: "sentencia",
  proceso: "proceso judicial en curso",
  investigacion: "investigación (sin acusación ni sentencia)",
  denuncia: "denuncia",
  "n/a": "",
};

function renderFact(f: Fact, sources: Source[] = []): string {
  if (f.evidence === "prensa" || f.evidence === "agregador") {
    const src = sources.filter((s) => f.sourceIds.includes(s.id));
    const lines = [`    • ${[f.date, safe(f.summary)].filter(Boolean).join("  ")}`];
    if (LEGAL_LABEL[f.legalStatus]) lines.push(`      ${muted("Estado:")} ${LEGAL_LABEL[f.legalStatus]}`);
    if (f.quote) lines.push(`      ${muted(`“${safe(f.quote).replace(/\s*\n\s*/g, " · ")}”`)}`);
    if (f.details.registro) lines.push(`      ${muted(`Registro de origen: ${safe(f.details.registro)}`)}`);
    for (const s of src) lines.push(`      ${muted(`${safe(s.publisher)}${s.title ? ` — ${safe(s.title)}` : ""}`)}\n      ${info(s.url)}`);
    const when = f.reviewedBy
      ? `revisado por ${f.reviewedBy} el ${(f.reviewedAt ?? "").slice(0, 10)}`
      : `consultado el ${(src[0]?.accessedAt ?? "").slice(0, 10)}, sin revisión humana`;
    lines.push(`      ${dim(`${EVIDENCE_LABEL[f.evidence]} · ${when}`)}`);
    return lines.join("\n");
  }
  const d = f.details;
  const head = [f.date, d.materia ?? d.rubro].filter(Boolean).map((x) => safe(String(x))).join("  ");
  const lines = [`    • ${head}`];
  const body = [d.fallo, d.modalidad, d.cumplimiento].filter(Boolean).map((x) => safe(String(x)));
  if (body.length) lines.push(`      ${body.join(" · ")}`);
  const where = [d.juzgado, d.expediente ? `Exp. ${d.expediente}` : null, d.resolucion].filter(Boolean).map((x) => safe(String(x)));
  if (where.length) lines.push(`      ${muted(where.join(" · "))}`);
  if (d.comentario) lines.push(`      ${muted(`Nota del candidato: ${safe(d.comentario)}`)}`);
  if (d.nota) lines.push(`      ${muted(safe(d.nota))}`);
  lines.push(`      ${dim(`${EVIDENCE_LABEL[f.evidence] ?? f.evidence} · fuente ${f.sourceIds.join(", ")}`)}`);
  return lines.join("\n");
}

export function candidateCompare(ds: Dataset, ctx: Ctx, args: Args): number {
  if (args._.length < 2) throw usage("Compara al menos dos candidatos.", "Ejemplo: votape candidate compare <id> <id>");
  const cands = args._.map((q) => findCandidate(ds, q));
  const rows = cands.map((c) => {
    const inc = [...c.assets.income].sort((a, b) => (b.year ?? "").localeCompare(a.year ?? ""))[0];
    const top = c.education.entries.find((e) => e.level === "posgrado") ?? c.education.entries.find((e) => e.level === "universitaria") ?? c.education.entries[0];
    return {
      ...summarize(ds, c),
      highestEducation: top ? { level: top.level, program: top.program, institution: top.institution, completed: top.completed } : null,
      publicOffices: c.publicOffices.length,
      partyResignations: c.partyResignations.length,
      latestIncome: inc ? { year: inc.year, total: inc.total } : null,
      realEstate: c.assets.realEstate.length,
      planPdfUrl: c.plan.pdfUrl,
    };
  });
  return respond(ctx, { candidates: rows }, rows.map((r) => ({ command: `votape candidate get ${r.id}`, description: `Perfil de ${r.name}` })), (d) => {
    const colW = Math.max(18, Math.floor((width() - 30) / d.candidates.length) - 2);
    const line = (label: string, vals: string[]) =>
      `  ${padVisible(muted(label), 28)}${vals.map((v) => padVisible(truncateVisible(v, colW), colW)).join("  ")}`;
    const c = d.candidates;
    return [
      "",
      line("", c.map((x) => bold(safe(x.name)))),
      line("Organización", c.map((x) => safe(x.party))),
      line("Circunscripción", c.map((x) => x.jurisdiction.name)),
      line("Estado", c.map((x) => statusStyle(x.status))),
      line("Edad", c.map((x) => (x.age === null ? "—" : `${x.age}`))),
      line("Educación más alta", c.map((x) => (x.highestEducation ? safe(x.highestEducation.program) : "—"))),
      line("Cargos de elección previos", c.map((x) => `${x.publicOffices}`)),
      line("Renuncias a partidos", c.map((x) => `${x.partyResignations}`)),
      line("Sentencias penales", c.map((x) => `${x.facts.criminal_sentence ?? 0}`)),
      line("Sentencias por oblig.", c.map((x) => `${x.facts.civil_obligation ?? 0}`)),
      line("Anotaciones del JNE", c.map((x) => `${x.facts.marginal_note ?? 0}`)),
      line("Ingresos declarados", c.map((x) => (x.latestIncome ? `${money(x.latestIncome.total)} (${x.latestIncome.year})` : "—"))),
      line("Inmuebles", c.map((x) => `${x.realEstate}`)),
      "",
      muted("  Solo hechos declarados o registrados; votape no puntúa ni recomienda candidatos."),
      legalFooter(),
    ].join("\n");
  });
}

// ---------------------------------------------------------------- jurisdiction

function candidacyRow(ds: Dataset, c: Candidacy, j: Jurisdiction): CandidateSummary {
  const cand = c.candidateId ? ds.candidates.get(c.candidateId) : undefined;
  if (cand) return summarize(ds, cand);
  return {
    id: "",
    slug: "",
    name: c.name ?? "(sin candidato a alcalde)",
    age: null,
    party: c.party.name,
    jurisdiction: { id: j.id, name: j.name },
    office: c.office,
    status: c.status,
    facts: {},
  };
}

export function jurisdictionList(ds: Dataset, ctx: Ctx, args: Args): number {
  const election = pickElection(ds, args);
  const rows = [...ds.jurisdictions.values()]
    .filter((j) => j.electionId === election.id)
    .map((j) => {
      const cands = j.candidacies.map((c) => (c.candidateId ? ds.candidates.get(c.candidateId) : undefined)).filter((c): c is Candidate => Boolean(c));
      return {
        id: j.id,
        name: j.name,
        level: j.level,
        candidacies: j.candidacies.length,
        registered: j.candidacies.filter((c) => c.status === "INSCRITO").length,
        withCriminalSentence: cands.filter((c) => visibleFacts(c).some((f) => f.category === "criminal_sentence")).length,
      };
    })
    .sort((a, b) => (a.level === b.level ? a.name.localeCompare(b.name) : a.level === "provincial" ? -1 : 1));
  return respond(ctx, { election: { id: election.id, name: election.name, date: election.date }, total: rows.length, results: rows }, [{ command: "votape jurisdiction get <ubigeo|nombre>", description: "Candidatos de una circunscripción" }], (d) => {
    const head = `  ${padVisible(dim("Ubigeo"), 8)}${padVisible(dim("Circunscripción"), 28)}${padStartVisible(dim("Listas"), 7)}${padStartVisible(dim("Inscritos"), 11)}${padStartVisible(dim("Con sent. penal decl."), 23)}`;
    const lines = d.results.map(
      (r) =>
        `  ${padVisible(muted(r.id), 8)}${padVisible(r.level === "provincial" ? bold(r.name) : r.name, 28)}${padStartVisible(`${r.candidacies}`, 7)}${padStartVisible(`${r.registered}`, 11)}${padStartVisible(r.withCriminalSentence ? `${r.withCriminalSentence}` : muted("0"), 23)}`,
    );
    return [`\n  ${bold(d.election.name)} ${muted(`· ${d.election.date} · ${d.total} circunscripciones`)}\n`, head, ...lines, "", muted("  Siguiente: votape jurisdiction get miraflores")].join("\n");
  });
}

export function jurisdictionGet(ds: Dataset, ctx: Ctx, args: Args): number {
  const q = args._.join(" ").trim();
  if (!q) throw usage("Falta el ubigeo o nombre.", "Ejemplo: votape jurisdiction get miraflores");
  const election = pickElection(ds, args);
  const j = findJurisdiction(ds, election, q);
  const rows = j.candidacies.map((c) => candidacyRow(ds, c, j));
  const data = { ...j, candidacies: j.candidacies.map((c, i) => ({ ...c, summary: rows[i]?.id ? rows[i] : null })) };
  return respond(ctx, data, [{ command: "votape candidate get <id>", description: "Perfil completo de un candidato" }, { command: `votape candidate compare <id> <id>`, description: "Comparar candidatos" }], () =>
    [`\n  ${bold(j.name)} ${muted(`· ${j.level === "provincial" ? "alcaldía provincial" : "alcaldía distrital"} · ubigeo JNE ${j.id} · ${rows.length} listas`)}\n`, candidateTable(rows, false), "", legend()].join("\n"),
  );
}

// ---------------------------------------------------------------- election, fact, source

export function electionList(ds: Dataset, ctx: Ctx): number {
  const rows = ds.elections.map((e) => ({ id: e.id, name: e.name, date: e.date, scope: e.scope, jurisdictions: e.jurisdictionIds.length, snapshotAt: e.snapshotAt }));
  return respond(ctx, rows, [{ command: "votape election get <id>", description: "Detalle y cobertura de fuentes" }], (d) =>
    ["", ...d.map((e) => `  ${bold(e.id)}  ${e.name} ${muted(`· ${e.date} · ${e.scope} · datos al ${e.snapshotAt.slice(0, 10)}`)}`)].join("\n"),
  );
}

export function electionGet(ds: Dataset, ctx: Ctx, args: Args): number {
  const e = pickElection(ds, { ...args, election: args._[0] ?? args.election });
  const cands = [...ds.candidates.values()].filter((c) => c.electionId === e.id);
  const data = { ...e, candidates: cands.length };
  return respond(ctx, data, [{ command: "votape jurisdiction list", description: "Circunscripciones" }, { command: "votape source list", description: "Fuentes y licencias" }], (d) =>
    [
      `\n  ${bold(d.name)}`,
      `  ${muted("Fecha:")} ${d.date} · ${d.rounds}`,
      `  ${muted("Alcance:")} ${d.scope} · ${d.jurisdictionIds.length} circunscripciones · ${d.candidates} candidatos con hoja de vida`,
      `  ${muted("Datos al:")} ${d.snapshotAt}`,
      section("Cobertura por fuente"),
      ...d.coverage.map((c) => `  ${padVisible(c.status === "complete" ? ok("completa") : warn(c.status === "partial" ? "parcial" : "pendiente"), 12)}${padVisible(c.providerId, 22)}${muted(c.note)}`),
    ].join("\n"),
  );
}

export function factList(ds: Dataset, ctx: Ctx, args: Args): number {
  const election = pickElection(ds, args);
  let cands = [...ds.candidates.values()].filter((c) => c.electionId === election.id);
  const cq = str(args.candidate);
  if (cq) cands = [findCandidate(ds, cq)];
  const jq = str(args.jurisdiction);
  if (jq) {
    const j = findJurisdiction(ds, election, jq);
    cands = cands.filter((c) => c.jurisdictionId === j.id);
  }
  const category = str(args.category);
  if (category && !(category in CATEGORY_LABEL)) throw usage(`Categoría desconocida: ${category}`, `Válidas: ${Object.keys(CATEGORY_LABEL).join(", ")}`);
  const evidence = str(args.evidence);
  const rows = cands.flatMap((c) =>
    visibleFacts(c)
      .filter((f) => (!category || f.category === category) && (!evidence || f.evidence === evidence))
      .map((f) => ({
        ...f,
        candidate: { id: c.id, name: c.name, party: c.party.name, jurisdictionId: c.jurisdictionId },
        sources: c.sources.filter((s) => f.sourceIds.includes(s.id)),
      })),
  );
  const limit = args.limit === undefined ? rows.length : limitOf(args, rows.length);
  const data = { total: rows.length, results: rows.slice(0, limit) };
  return respond(ctx, data, [{ command: "votape candidate get <id>", description: "Perfil completo del candidato" }], (d) => {
    const out = [`\n  ${bold(`${d.total} hechos`)} ${muted(category ? `· ${CATEGORY_LABEL[category as FactCategory]}` : "")}`];
    let last = "";
    for (const f of d.results) {
      if (f.candidate.id !== last) {
        out.push(`\n  ${bold(safe(f.candidate.name))} ${muted(`· ${safe(f.candidate.party)}`)}`);
        last = f.candidate.id;
      }
      out.push(`    ${muted(CATEGORY_LABEL[f.category])}`);
      out.push(renderFact(f, f.sources));
    }
    if (d.total > d.results.length) out.push(muted(`\n  … y ${d.total - d.results.length} más`));
    out.push(legalFooter());
    return out.join("\n");
  });
}

export function sourceList(ds: Dataset, ctx: Ctx): number {
  return respond(ctx, ds.providers, [{ command: "votape source get <id>", description: "Licencia y metodología de una fuente" }], (d) =>
    ["", ...d.map((p) => `  ${padVisible(bold(p.id), 22)}${padVisible(p.kind, 11)}${padVisible(p.permission === "pending" ? warn("permiso pendiente") : p.permission === "denied" ? warn("permiso denegado") : ok("en uso"), 20)}${muted(p.name)}`)].join("\n"),
  );
}

export function sourceGet(ds: Dataset, ctx: Ctx, args: Args): number {
  const id = args._[0];
  const p = ds.providers.find((x) => x.id === id);
  if (!p) throw notFound(`No existe la fuente "${id ?? ""}".`, "Corre: votape source list");
  return respond(ctx, p, [{ command: "votape source list", description: "Todas las fuentes" }], (d) =>
    [
      `\n  ${bold(d.name)} ${muted(`(${d.id})`)}`,
      `  ${muted("Publica:")} ${d.publisher}`,
      `  ${muted("Tipo:")} ${d.kind} · ${muted("acceso:")} ${d.access}`,
      `  ${muted("URL:")} ${info(d.url)}`,
      `  ${muted("Licencia:")} ${d.license}`,
      `  ${muted("Permiso:")} ${d.permission}`,
      d.methodologyUrl ? `  ${muted("Metodología:")} ${info(d.methodologyUrl)}` : "",
      d.notes ? `\n  ${d.notes}` : "",
    ].filter(Boolean).join("\n"),
  );
}

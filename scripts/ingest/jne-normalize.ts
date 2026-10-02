// Stage 2 of the JNE ingest: turn cached raw responses into the public JSON.
//
// Privacy rules applied here (see PLAN.md Q17 and friction.md):
//   - no DNI, no birth date (age only), no photo URL (it embeds the DNI)
//   - no property addresses, SUNARP partidas or vehicle plates
//   - civil obligation rulings are not copied: the text names third parties,
//     including minors. Matter, court, case number and date are kept.
//
// Usage: bun run scripts/ingest/jne-normalize.ts

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Candidacy,
  Candidate,
  Election,
  Fact,
  Jurisdiction,
  Source,
  StatusChange,
} from "../../src/model.js";
import type { CachedResponse } from "./jne-fetch.js";

/** JNE idTipoEleccion: 5 = municipal provincial, 6 = municipal distrital. */
const raceType = (scopeId: string) => (scopeId === "00" ? 5 : 6);

const ELECTION_ID = "erm-2026";
const ELECTION_DATE = "2026-10-04";
const CACHE = join(process.cwd(), ".cache/jne/erm-2026");
const OUT = join(process.cwd(), "data/elections", ELECTION_ID);
const PLAN_DOCS = "https://mpesije.jne.gob.pe/docs/";

// biome-ignore lint/suspicious/noExplicitAny: raw JNE payloads are untyped
type Raw = any;

const read = <T = Raw>(file: string): CachedResponse<T> | null => {
  const p = join(CACHE, file);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as CachedResponse<T>) : null;
};

const clean = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
const orNull = (s: unknown): string | null => clean(s) || null;
/** Free text written by candidates sometimes includes a DNI; never republish it. */
const redact = (s: string): string => s.replace(/(D\.?\s?N\.?\s?I\.?[^0-9]{0,15})\d{8}\b/gi, "$1[DNI omitido]");
const num = (s: unknown): number | null => {
  if (s === null || s === undefined || s === "") return null;
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const yes = (s: unknown): boolean | null => (s === "SI" ? true : s === "NO" ? false : null);
const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, p, c: string) => p + c.toUpperCase());
const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const isoDate = (ddmmyyyy: unknown): string | null => {
  const m = clean(ddmmyyyy).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

function ageAt(birth: string | null, on: string): number | null {
  if (!birth) return null;
  const b = new Date(birth);
  const d = new Date(on);
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  const m = d.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && d.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

function sourceFrom(id: string, cached: CachedResponse): Source {
  return {
    id,
    providerId: "jne-voto-informado",
    url: cached.url,
    sha256: cached.sha256,
    accessedAt: cached.fetchedAt,
    publisher: "Jurado Nacional de Elecciones",
    extractedBy: "api",
  };
}

function facts(hv: Raw, srcId: string): Fact[] {
  const out: Fact[] = [];
  for (const s of hv.sentenciaPenal ?? []) {
    if (s.tengoSentenciaPenal === "NO") continue;
    const materia = clean(s.materia);
    const fallo = clean(s.fallo);
    out.push({
      id: `jne-penal-${s.idHvSentenciaPenal}`,
      category: "criminal_sentence",
      summary: `Sentencia penal declarada: ${materia || "materia no especificada"}`,
      evidence: "declarado",
      legalStatus: "sentencia",
      date: isoDate(s.fecSentencia) ?? undefined,
      details: {
        materia: orNull(s.materia),
        fallo: orNull(s.fallo),
        modalidad: orNull(s.modalidad),
        cumplimiento: orNull(s.cumplimientoPena),
        juzgado: orNull(s.fuero),
        expediente: orNull(s.expediente),
        comentario: orNull(s.txComentario) && redact(clean(s.txComentario)),
      },
      quote: [materia, fallo, clean(s.modalidad), clean(s.cumplimientoPena)].filter(Boolean).join(" · "),
      sourceIds: [srcId],
      needsReview: false,
    });
  }
  for (const s of hv.sentenciaObliga ?? []) {
    if (s.tengoSentenciaObliga === "NO") continue;
    const materia = clean(s.materia);
    out.push({
      id: `jne-obliga-${s.idHvSentenciaObliga}`,
      category: "civil_obligation",
      summary: `Sentencia por obligación declarada: ${materia || "materia no especificada"}`,
      evidence: "declarado",
      legalStatus: "sentencia",
      date: isoDate(s.fecSentencia) ?? undefined,
      details: {
        materia: orNull(s.materia),
        juzgado: orNull(s.fuero),
        expediente: orNull(s.expediente),
        fallo: null,
        nota: "Texto del fallo omitido: contiene datos de terceros. Ver la fuente del JNE.",
      },
      quote: materia,
      sourceIds: [srcId],
      needsReview: false,
    });
  }
  for (const a of hv.anotacionMarginal ?? []) {
    out.push({
      id: `jne-anotacion-${a.idAnotacionMarginal}`,
      category: "marginal_note",
      summary: `Anotación marginal del JNE sobre: ${titleCase(clean(a.rubro))}`,
      evidence: "registro_oficial",
      legalStatus: "n/a",
      date: clean(a.fePublicacion) || clean(a.feRegistro) || undefined,
      details: {
        rubro: orNull(a.rubro),
        resolucion: orNull(a.nroDocumento),
        // "dice"/"debeDecir" restate whole CV sections, addresses included.
        nota: "Texto de la corrección omitido: puede repetir datos personales. Ver la fuente del JNE.",
      },
      quote: clean(a.nroDocumento),
      sourceIds: [srcId],
      needsReview: false,
    });
  }
  return out;
}

function candidate(
  hvCached: CachedResponse<Raw>,
  plan: CachedResponse<Raw> | null,
  list: Raw,
  previous: Candidate | null,
): Candidate {
  const hv = hvCached.data.data;
  const g = hv.datoGeneral;
  const srcId = `jne-hv-${g.idHojaVida}`;
  const sources: Source[] = [sourceFrom(srcId, hvCached)];
  const planData = plan?.data?.data;
  if (plan && planData) sources.push(sourceFrom(`jne-plan-${list.codigoExpediente}`, plan));

  const givenNames = titleCase(clean(g.nombres));
  const surnames = titleCase(`${clean(g.apellidoPaterno)} ${clean(g.apellidoMaterno)}`.trim());
  const status = clean(g.estado);
  const statusHistory: StatusChange[] = previous?.statusHistory ? [...previous.statusHistory] : [];
  if (statusHistory.at(-1)?.status !== status) {
    statusHistory.push({ status, observedAt: hvCached.fetchedAt, sourceId: srcId });
  }

  const fa = hv.formacionAcademica ?? {};
  const eb = fa.educacionBasica;
  const dj = hv.declaracionJurada ?? {};
  const tr = hv.trayectoria ?? {};
  const has = (v: unknown) => v !== "NO" && v !== "0";

  return {
    id: g.idHojaVida,
    slug: slugify(`${givenNames} ${surnames}`),
    electionId: ELECTION_ID,
    name: `${givenNames} ${surnames}`,
    givenNames,
    surnames,
    age: ageAt(isoDate(g.feNacimiento), ELECTION_DATE),
    gender: orNull(g.desSexo),
    party: { id: g.idOrganizacionPolitica, name: clean(g.organizacionPolitica) },
    jurisdictionId: clean(g.ubigeoPostula),
    office: clean(g.cargo),
    status,
    statusHistory,
    education: {
      basic:
        eb && eb.tengoEduBasica === "SI"
          ? { primary: eb.concluidoEduPrimaria === "SI", secondary: eb.concluidoEduSecundaria === "SI" }
          : null,
      entries: [
        ...(fa.educacionTecnico ?? []).filter((e: Raw) => has(e.tengoEduTecnico)).map((e: Raw) => ({
          level: "tecnico" as const,
          institution: clean(e.centroEstudio),
          program: clean(e.carreraTecnico),
          completed: yes(e.concluidoEduTec),
          degree: orNull(e.tituloTec),
          year: orNull(e.anioTitulo),
        })),
        ...(fa.educacionNoUniversitaria ?? []).filter((e: Raw) => has(e.tengoNoUniversitaria)).map((e: Raw) => ({
          level: "no_universitaria" as const,
          institution: clean(e.centroEstudio),
          program: clean(e.carreraNoUni),
          completed: yes(e.concluidoNoUni),
          degree: orNull(e.tituloNoUni),
          year: orNull(e.anioTitulo),
        })),
        ...(fa.educacionUniversitaria ?? []).filter((e: Raw) => has(e.tengoEduUniversitaria)).map((e: Raw) => ({
          level: "universitaria" as const,
          institution: clean(e.universidad),
          program: clean(e.carreraUni),
          completed: yes(e.concluidoEduUni),
          degree: e.tituloUni ? "Título" : e.anioBachiller || e.bachillerEduUni ? "Bachiller" : null,
          year: orNull(e.anioTitulo) ?? orNull(e.anioBachiller),
        })),
        ...(fa.educacionPosgrado ?? []).filter((e: Raw) => has(e.tengoPosgrado)).map((e: Raw) => ({
          level: "posgrado" as const,
          institution: clean(e.txCenEstudioPosgrado),
          program: clean(e.txEspecialidadPosgrado),
          completed: yes(e.concluidoPosgrado),
          degree: e.esDoctor === "SI" ? "Doctor" : e.esMaestro === "SI" ? "Maestro" : null,
          year: orNull(e.txAnioPosgrado),
        })),
        ...(fa.educacionPosgradoOtro ?? []).filter((e: Raw) => has(e.tengoPosgradoOtro)).map((e: Raw) => ({
          level: "posgrado_otro" as const,
          institution: clean(e.txCenEstudioPosgradoOtro),
          program: clean(e.txEspecialidadPosgradoOtro),
          completed: yes(e.concluidoPosgradoOtro),
          degree: clean(e.txGrado).replace(/^-+$/, "") || null,
          year: orNull(e.txAnioPosgradoOtro),
        })),
      ],
    },
    work: (hv.experienciaLaboral ?? [])
      .filter((w: Raw) => has(w.tengoExpeLaboral) && clean(w.centroTrabajo))
      .map((w: Raw) => ({
        employer: clean(w.centroTrabajo),
        role: clean(w.ocupacionProfesion),
        from: orNull(w.anioTrabajoDesde),
        to: orNull(w.anioTrabajoHasta),
      })),
    publicOffices: (tr.cargoEleccion ?? [])
      .filter((c: Raw) => has(c.tengoCargoEleccion) && clean(c.cargoEleccion))
      .map((c: Raw) => ({
        office: clean(c.cargoEleccion),
        party: clean(c.orgPolCargoElec),
        from: orNull(c.anioCargoElecDesde),
        to: orNull(c.anioCargoElecHasta),
      })),
    partyPositions: (tr.cargoPartidario ?? [])
      .filter((c: Raw) => has(c.tengoCargoPartidario) && clean(c.cargoPartidario))
      .map((c: Raw) => ({
        position: clean(c.cargoPartidario),
        party: clean(c.orgPolCargoPartidario),
        from: orNull(c.anioCargoPartiDesde),
        to: orNull(c.anioCargoPartiHasta),
      })),
    partyResignations: (hv.renunciaEfectuada ?? [])
      .filter((r: Raw) => has(r.tengoRenunciaOp) && clean(r.orgPolRenunciaOp))
      .map((r: Raw) => ({ party: clean(r.orgPolRenunciaOp), year: orNull(r.anioRenunciaOp ?? r.anioRenuncia) })),
    assets: {
      income: (dj.ingreso ?? [])
        .filter((i: Raw) => has(i.tengoIngresos) && has(i.idTengoIngresos))
        .map((i: Raw) => ({
          year: orNull(i.anioIngresos),
          total: num(i.totalIngresos) ?? 0,
          public:
            (num(i.remuBrutaPublico) ?? 0) + (num(i.rentaIndividualPublico) ?? 0) + (num(i.otroIngresoPublico) ?? 0),
          private:
            (num(i.remuBrutaPrivado) ?? 0) + (num(i.rentaIndividualPrivado) ?? 0) + (num(i.otroIngresoPrivado) ?? 0),
        })),
      realEstate: (dj.bienInmueble ?? [])
        .filter((b: Raw) => has(b.tengoInmueble) && has(b.idTengoinmueble))
        .map((b: Raw) => ({
          type: clean(b.tipoBienInmueble) || "INMUEBLE",
          value: num(b.autovaluo ?? b.flValor),
          registeredInSunarp: b.inmuebleSunarp === "1",
        })),
      vehicles: (dj.bienMueble ?? [])
        .filter((b: Raw) => has(b.tengoBienMueble) && has(b.idTengoBienMueble))
        .map((b: Raw) => ({ type: clean(b.caracteristica) || clean(b.vehiculo), value: num(b.valor) })),
      otherMovable: (dj.otroMueble ?? [])
        .filter((b: Raw) => Object.values(b).some((v) => v === "SI"))
        .map((b: Raw) => ({
          type: clean(b.caracteristica ?? b.txCaracteristica ?? b.descripcion ?? b.txDescripcion) || "OTRO",
          value: num(b.valor ?? b.flValor),
        })),
      holdings: (dj.titularidad ?? [])
        .filter((t: Raw) => has(t.tengoTitularidad) && clean(t.txPersonaJuridica))
        .map((t: Raw) => ({
          company: clean(t.txPersonaJuridica),
          type: clean(t.txTipoTitularidad),
          quantity: num(t.flCantidad),
          value: num(t.flValor),
        })),
    },
    additionalInfo: (hv.informacionAdicional ?? [])
      .filter((i: Raw) => i.tengoInfoAdicional === "SI" && clean(i.infoAdicional))
      .map((i: Raw) => redact(clean(i.infoAdicional))),
    plan: {
      pdfUrl: list.rutaPlanGobierno ? PLAN_DOCS + list.rutaPlanGobierno : null,
      summaryPdfUrl: planData?.datoGeneral?.txRutaResumen ? PLAN_DOCS + planData.datoGeneral.txRutaResumen : null,
      dimensions: (planData?.dimensiones ?? []).map((d: Raw) => ({
        name: clean(d.txDimension),
        items: (d.detalle ?? []).map((x: Raw) => ({
          problem: clean(x.txPgProblema),
          objective: clean(x.txPgObjetivo),
          goal: clean(x.txPgMeta),
          indicator: clean(x.txPgIndicador),
        })),
      })),
    },
    facts: facts(hv, srcId),
    sources,
  };
}

function main() {
  const districts = read<{ id: string; nombre: string }[]>("districts.json");
  if (!districts) throw new Error("Falta .cache: corre primero jne-fetch.ts");
  const scopes = [{ id: "00", nombre: "LIMA METROPOLITANA" }, ...districts.data];

  mkdirSync(join(OUT, "candidates"), { recursive: true });
  mkdirSync(join(OUT, "jurisdictions"), { recursive: true });

  const jurisdictionIds: string[] = [];
  let lastFetch = "";
  let candidates = 0;
  let missing = 0;

  for (const scope of scopes) {
    const orgs = read<Raw>(`scopes/${scope.id}/organizaciones.json`);
    if (!orgs) {
      missing++;
      continue;
    }
    const candidacies: Candidacy[] = [];
    let jurisdictionId = "";
    const lists = (orgs.data.data ?? [])
      .filter((g: Raw) => g.idTipoEleccion === raceType(scope.id))
      .flatMap((g: Raw) =>
      g.organizaciones.flatMap((o: Raw) => o.listas.map((l: Raw) => ({ org: o, list: l }))),
    );
    for (const { org, list } of lists) {
      const cands = read<Raw>(`scopes/${scope.id}/listas/${list.idSolicitudLista}.json`);
      const people: Raw[] = (cands?.data?.data ?? []).flatMap((g: Raw) =>
        g.organizaciones.flatMap((o: Raw) => o.listas.flatMap((l: Raw) => l.candidatos ?? [])),
      );
      const mayor = people.find((p) => clean(p.cargoEleccion).startsWith("ALCALDE"));
      if (mayor?.ubigeo) jurisdictionId = clean(mayor.ubigeo);
      const party = { id: org.idOrganizacionPolitica, name: clean(org.organizacionPolitica) };
      const status = clean(mayor?.estadoCandidato) || "SIN CANDIDATO A ALCALDE";
      const hvCached = mayor?.idHojaVida ? read<Raw>(`hojas-vida/${mayor.idHojaVida}.json`) : null;

      let candidateId: string | null = null;
      if (hvCached?.data?.data?.datoGeneral) {
        const id = mayor.idHojaVida as string;
        const file = join(OUT, "candidates", `${id}.json`);
        const previous = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Candidate) : null;
        const plan = read<Raw>(`planes/${list.codigoExpediente}.json`);
        const c = candidate(hvCached, plan, list, previous);
        writeFileSync(file, `${JSON.stringify(c, null, 2)}\n`);
        candidateId = id;
        candidates++;
        if (hvCached.fetchedAt > lastFetch) lastFetch = hvCached.fetchedAt;
      }
      candidacies.push({
        candidateId,
        name: mayor?.nombres
          ? titleCase(`${clean(mayor.nombres)} ${clean(mayor.apellidoPaterno)} ${clean(mayor.apellidoMaterno)}`)
          : null,
        party,
        office: scope.id === "00" ? "ALCALDE PROVINCIAL" : "ALCALDE DISTRITAL",
        status,
        listId: list.idSolicitudLista,
        expediente: clean(list.codigoExpediente),
      });
    }
    if (!jurisdictionId) jurisdictionId = scope.id === "00" ? "140100" : `1401${scope.id}`;
    const jurisdiction: Jurisdiction = {
      id: jurisdictionId,
      // JNE calls the Cercado district "LIMA"; renamed so "lima" is not ambiguous.
      name: scope.id === "00" ? "Lima Metropolitana" : scope.id === "01" ? "Cercado de Lima" : titleCase(scope.nombre),
      level: scope.id === "00" ? "provincial" : "distrital",
      parentId: scope.id === "00" ? null : "140100",
      electionId: ELECTION_ID,
      candidacies: candidacies.sort((a, b) => a.party.name.localeCompare(b.party.name)),
    };
    writeFileSync(join(OUT, "jurisdictions", `${jurisdictionId}.json`), `${JSON.stringify(jurisdiction, null, 2)}\n`);
    jurisdictionIds.push(jurisdictionId);
  }

  // Coverage for non-JNE providers is maintained by hand at release time
  // (e.g. press research progress); re-running this ingest must keep it.
  const electionFile = join(OUT, "election.json");
  const previousCoverage = existsSync(electionFile)
    ? (JSON.parse(readFileSync(electionFile, "utf8")) as Election).coverage.filter((c) => c.providerId !== "jne-voto-informado")
    : null;
  const election: Election = {
    id: ELECTION_ID,
    name: "Elecciones Regionales y Municipales 2026",
    date: ELECTION_DATE,
    rounds: "Vuelta única para alcaldes",
    scope: "Lima Metropolitana y sus 43 distritos (alcaldes)",
    offices: ["ALCALDE PROVINCIAL", "ALCALDE DISTRITAL"],
    jurisdictionIds: jurisdictionIds.sort(),
    snapshotAt: lastFetch,
    coverage: [
      { providerId: "jne-voto-informado", status: missing ? "partial" : "complete", note: "Hojas de vida, sentencias declaradas, anotaciones marginales y resumen del plan de gobierno." },
      ...(previousCoverage ?? [
        { providerId: "rtc", status: "pending" as const, note: "Pendiente de permiso del Consorcio RTC." },
        { providerId: "prensa", status: "pending" as const, note: "Investigación de prensa pendiente (v0.2)." },
      ]),
    ],
  };
  writeFileSync(electionFile, `${JSON.stringify(election, null, 2)}\n`);
  const stale = readdirSync(join(OUT, "candidates")).length - candidates;
  process.stderr.write(
    `normalizado: ${jurisdictionIds.length} circunscripciones, ${candidates} candidatos` +
      (missing ? `, ${missing} circunscripciones sin descargar` : "") +
      (stale > 0 ? `, ${stale} archivos de candidatos que ya no aparecen` : "") +
      "\n",
  );
}

main();

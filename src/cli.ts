#!/usr/bin/env node
import pkg from "../package.json" with { type: "json" };
import {
  type Args,
  CATEGORY_LABEL,
  candidateCompare,
  candidateGet,
  candidateList,
  candidateSearch,
  electionGet,
  electionList,
  factList,
  jurisdictionGet,
  jurisdictionList,
  sourceGet,
  sourceList,
} from "./commands.js";
import { type Dataset, load } from "./data.js";
import { printBanner } from "./lib/foundation/banner.js";
import { parseArgv } from "./lib/foundation/argv.js";
import { bold, muted } from "./lib/platform/style.js";
import { SCHEMA_VERSION } from "./model.js";
import { type Ctx, DISCLAIMER, LEGAL_URL, fail, isJson, respond, usage } from "./output.js";

type Handler = (ds: Dataset, ctx: Ctx, args: Args) => number;

const COMMANDS: Record<string, Record<string, Handler>> = {
  candidate: { search: candidateSearch, list: candidateList, get: candidateGet, compare: candidateCompare },
  jurisdiction: { list: jurisdictionList, get: jurisdictionGet },
  election: { list: electionList, get: electionGet },
  fact: { list: factList },
  source: { list: sourceList, get: sourceGet },
};

const BOOLEAN_FLAGS = new Set(["json", "help", "h", "version", "v"]);

// The contract `votape schema` publishes. Kept beside the router so a new
// command cannot ship without an entry here.
const SURFACE = [
  { command: "votape <texto>", description: "Atajo de candidate search", output: "{query,total,results:CandidateSummary[]}" },
  { command: "votape candidate search <texto> [--jurisdiction] [--election] [--limit]", description: "Busca por nombre, partido o distrito (sin tildes, todas las palabras)", output: "{query,total,results:CandidateSummary[]}" },
  { command: "votape candidate list [<jurisdicción>] [--jurisdiction] [--status] [--has-fact <categoría>] [--limit]", description: "Lista candidaturas con filtros", output: "{total,results:CandidateSummary[]}" },
  { command: "votape candidate get <id|slug|nombre>", description: "Perfil completo con hechos y fuentes", output: "Candidate & {jurisdiction,coverage}" },
  { command: "votape candidate compare <id> <id> [...]", description: "Comparación lado a lado, solo hechos", output: "{candidates:(CandidateSummary & {...})[]}" },
  { command: "votape jurisdiction list [--election]", description: "Circunscripciones con conteos", output: "{election,total,results:{id,name,level,candidacies,registered,withCriminalSentence}[]}" },
  { command: "votape jurisdiction get <ubigeo|nombre>", description: "Candidaturas de una circunscripción", output: "Jurisdiction & {candidacies:(Candidacy & {summary})[]}" },
  { command: "votape election list", description: "Procesos electorales incluidos", output: "{id,name,date,scope,jurisdictions,snapshotAt}[]" },
  { command: "votape election get [<id>]", description: "Detalle y cobertura por fuente", output: "Election & {candidates}" },
  { command: "votape fact list [--candidate] [--jurisdiction] [--category] [--evidence] [--limit]", description: "Antecedentes con sus fuentes", output: "{total,results:(Fact & {candidate,sources})[]}" },
  { command: "votape source list", description: "Catálogo de proveedores de datos", output: "Provider[]" },
  { command: "votape source get <id>", description: "Licencia, permiso y metodología de un proveedor", output: "Provider" },
  { command: "votape schema", description: "Este contrato", output: "Schema" },
  { command: "votape about", description: "Metodología, privacidad y correcciones", output: "About" },
];

function help(): string {
  const rows = SURFACE.map((s) => `  ${s.command}\n      ${muted(s.description)}`).join("\n");
  return [
    `${bold("Uso:")} votape <sustantivo> <verbo> [args] [flags]`,
    "",
    rows,
    "",
    `${bold("Flags globales")}`,
    "  --json            Salida JSON (automática si stdout no es una terminal)",
    "  --election <id>   Elección a consultar (por defecto la más reciente)",
    "  --help, -h        Esta ayuda",
    "  --version, -v     Versión",
    "",
    `${bold("Ejemplos")}`,
    "  votape bruce",
    "  votape jurisdiction get miraflores",
    "  votape candidate list --has-fact criminal_sentence --jurisdiction 'lima metropolitana'",
    "  votape fact list --category civil_obligation --json",
    "",
    muted("Códigos de salida: 0 ok · 1 error interno · 2 uso incorrecto · 4 no encontrado"),
  ].join("\n");
}

function schema(ds: Dataset, ctx: Ctx): number {
  const data = {
    name: "votape",
    version: pkg.version,
    schemaVersion: SCHEMA_VERSION,
    dataVersion: ctx.dataVersion,
    elections: ds.elections.map((e) => e.id),
    envelope: {
      success: "{ ok: true, data, nextSteps: {command,description}[], meta: {schemaVersion,dataVersion,electionId,notice} }",
      failure: "{ ok: false, error: {code: 'USAGE'|'NOT_FOUND'|'INTERNAL', message, hint?}, meta }",
    },
    exitCodes: { "0": "ok", "1": "error interno", "2": "uso incorrecto", "4": "no encontrado" },
    commands: SURFACE,
    types: {
      CandidateSummary: "{id,slug,name,age,party,jurisdiction:{id,name},office,status,facts:Record<FactCategory,number>}",
      Candidate: "{id,slug,electionId,name,givenNames,surnames,age,gender,party:{id,name},jurisdictionId,office,status,statusHistory[],education:{basic,entries[]},work[],publicOffices[],partyPositions[],partyResignations[],assets:{income[],realEstate[],vehicles[],otherMovable[],holdings[]},additionalInfo[],plan:{pdfUrl,summaryPdfUrl,dimensions[]},facts:Fact[],sources:Source[],result?}",
      Fact: "{id,category:FactCategory,summary,evidence:Evidence,legalStatus:LegalStatus,date?,details,quote?,sourceIds[],needsReview,reviewedBy?,reviewedAt?,supersededBy?}",
      Source: "{id,providerId,url,archivedUrl?,sha256?,accessedAt,publisher,extractedBy:'api'|'scraper'|'agent'|'manual'}",
      Provider: "{id,name,publisher,kind:'oficial'|'agregador'|'prensa',access,url,license,permission:'n/a'|'pending'|'granted'|'denied',methodologyUrl?,notes?}",
      Jurisdiction: "{id (ubigeo JNE),name,level:'provincial'|'distrital',parentId,electionId,candidacies:Candidacy[]}",
      Election: "{id,name,date,rounds,scope,offices[],jurisdictionIds[],snapshotAt,coverage:{providerId,status,note}[]}",
    },
    enums: {
      FactCategory: Object.keys(CATEGORY_LABEL),
      Evidence: ["declarado", "registro_oficial", "agregador", "prensa"],
      LegalStatus: ["sentencia", "proceso", "investigacion", "denuncia", "n/a"],
    },
    guarantees: [
      "Solo se publican hechos con needsReview=false y sin supersededBy.",
      "Cada hecho referencia al menos una Source por sourceIds.",
      "No se incluyen DNI, fecha de nacimiento, fotos, direcciones, placas ni el texto de fallos que nombra a terceros.",
      "votape no puntúa ni recomienda candidatos.",
    ],
    disclaimer: DISCLAIMER,
    legalUrl: LEGAL_URL,
  };
  return respond(ctx, data, [{ command: "votape about", description: "Metodología" }], (d) => JSON.stringify(d, null, 2));
}

function about(ds: Dataset, ctx: Ctx): number {
  const data = {
    version: pkg.version,
    dataVersion: ctx.dataVersion,
    methodology: [
      "Los datos del JNE se descargan de la API pública de Voto Informado y se normalizan sin interpretarlos.",
      "Cada hecho indica su tipo de evidencia: declarado por el candidato, registro oficial, agregador o prensa.",
      "'Declarado' significa que el propio candidato lo consignó en su hoja de vida; votape no afirma más que eso.",
      "Lo que extrae un modelo de lenguaje no se publica hasta que una persona lo revisa.",
      "votape no puntúa, no ordena por mérito y no recomienda candidatos.",
    ],
    privacy: [
      "Se omiten DNI, fecha de nacimiento (solo la edad), fotos, direcciones, placas y partidas registrales.",
      "En sentencias por obligaciones se omite el texto del fallo porque nombra a terceros, incluidos menores.",
    ],
    legal: {
      summary: DISCLAIMER,
      points: [
        "votape reproduce fuentes públicas y dice quién afirma cada hecho; no afirma hechos propios.",
        "Una denuncia, investigación o proceso no es una condena: rige la presunción de inocencia. Cada hecho indica su estado legal.",
        "Los datos son una foto a una fecha y pueden tener errores de las fuentes; se ofrecen 'tal cual', sin garantías (licencia MIT).",
        "El autor no responde por el uso, la interpretación o la redistribución que terceros (personas o agentes de IA) hagan de estos datos, en la medida en que la ley lo permita.",
        "No uses votape para acosar, discriminar o exponer a nadie. Quien redistribuya debe citar la fuente original y el estado legal.",
        "Correcciones y derechos sobre datos personales (Ley 29733): respuesta en 7 días calendario.",
      ],
      url: LEGAL_URL,
    },
    corrections: "https://github.com/Jibaru/votape/blob/main/CORRECTIONS.md",
    repository: "https://github.com/Jibaru/votape",
    sources: ds.providers.map((p) => ({ id: p.id, name: p.name, permission: p.permission })),
  };
  return respond(ctx, data, [{ command: "votape source list", description: "Fuentes y licencias" }], (d) =>
    [
      `\n  ${bold("votape")} ${muted(`v${d.version} · datos al ${d.dataVersion}`)}`,
      `\n  ${bold("Metodología")}`,
      ...d.methodology.map((m) => `  • ${m}`),
      `\n  ${bold("Privacidad")}`,
      ...d.privacy.map((m) => `  • ${m}`),
      `\n  ${bold("Aviso legal")}`,
      ...d.legal.points.map((m) => `  • ${m}`),
      `  ${muted(d.legal.url)}`,
      `\n  ${bold("¿Un dato está mal?")} ${d.corrections}`,
    ].join("\n"),
  );
}

export function main(argv: string[]): number {
  const args = parseArgv(argv, BOOLEAN_FLAGS) as Args;
  const ctx: Ctx = { json: Boolean(args.json), dataVersion: "", electionId: null };
  try {
    if (args.version || args.v) {
      return respond(ctx, { version: pkg.version }, [], (d) => d.version);
    }
    const [noun, verb, ...rest] = args._;
    if (!noun || args.help || args.h) {
      if (!isJson(ctx)) printBanner({ name: "votape", tagline: "Candidatos con fuentes", version: pkg.version, gradient: ["#E63946", "#F1FAEE"] });
      return respond(ctx, { usage: "votape <sustantivo> <verbo> [args] [flags]", commands: SURFACE }, [{ command: "votape schema", description: "Contrato completo en JSON" }], help);
    }

    const ds = load();
    const latest = ds.elections[0];
    ctx.dataVersion = latest?.snapshotAt ?? "";
    ctx.electionId = typeof args.election === "string" ? args.election : (latest?.id ?? null);

    if (noun === "schema") return schema(ds, ctx);
    if (noun === "about") return about(ds, ctx);

    const group = COMMANDS[noun];
    if (!group) return candidateSearch(ds, ctx, { ...args, _: args._ });
    if (!verb) throw usage(`Falta el verbo para "${noun}".`, `Opciones: ${Object.keys(group).map((v) => `votape ${noun} ${v}`).join(", ")}`);
    const handler = group[verb];
    if (!handler) throw usage(`"${noun} ${verb}" no existe.`, `Opciones: ${Object.keys(group).map((v) => `votape ${noun} ${v}`).join(", ")}`);
    return handler(ds, ctx, { ...args, _: rest });
  } catch (err) {
    return fail(ctx, err);
  }
}

process.exitCode = main(process.argv.slice(2));

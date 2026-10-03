#!/usr/bin/env bun
// votape-dev: the only part of votape that writes, and it never ships to npm.
//
//   queue add <file.json> [--dry-run]     validate proposed facts and queue them
//   queue list                            pending proposals
//   review                                interactive review (TTY only)
//   review approve <id> [--summary] [--legal-status] [--dry-run]   (TTY only)
//   review reject <id> --reason <text> [--dry-run]
//
// Proposals live in .cache/review/ (gitignored): an unreviewed claim about a
// person must not land in a public repo. Approval is the only path into
// data/elections/<election>/facts/, it requires a real terminal, and there is
// no --yes: an agent must not be able to approve on the reviewer's behalf.

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fold, load } from "../src/data.js";
import { parseArgv } from "../src/lib/foundation/argv.js";
import { atomicWriteJson } from "../src/lib/foundation/atomic-write.js";
import { beginAudit } from "../src/lib/foundation/audit-lifecycle.js";
import { AppError } from "../src/lib/foundation/error-map.js";
import { bold, info, muted, ok, warn } from "../src/lib/platform/style.js";
import type { Candidate, ExtraFacts, Fact, FactCategory, LegalStatus, Source } from "../src/model.js";
import { type Ctx, fail, respond, usage } from "../src/output.js";

const ROOT = join(import.meta.dir, "..");
const REVIEW = join(ROOT, ".cache/review");
const QUEUE = join(REVIEW, "queue");
const APPROVED = join(REVIEW, "approved");
const REJECTED = join(REVIEW, "rejected");
const AUDIT = join(ROOT, ".cache/audit");
const UA = "votape/0.2 (+https://github.com/Jibaru/votape; verificación de citas)";

const CATEGORIES: FactCategory[] = ["press_report", "judicial_process", "sanction", "state_contract", "traffic", "reinfo"];
const LEGAL: LegalStatus[] = ["sentencia", "proceso", "investigacion", "denuncia", "n/a"];

export type Proposal = {
  candidateId: string;
  category: FactCategory;
  summary: string;
  legalStatus: LegalStatus;
  date?: string;
  url: string;
  title?: string;
  publisher: string;
  quote: string;
  identityEvidence: string;
  proposedBy: string;
};

type QueueItem = {
  id: string;
  proposal: Proposal;
  queuedAt: string;
  check: { domain: string; fetched: boolean; httpStatus: number | null; quoteVerified: boolean; sha256: string | null; archivedUrl: string | null; note: string };
  decision?: { by: string; at: string; reason?: string };
};

const BOOLEANS = new Set(["json", "dryRun", "help"]);
const args = parseArgv(process.argv.slice(2), BOOLEANS);
const dryRun = Boolean(args.dryRun);
const ctx: Ctx = { json: Boolean(args.json), dataVersion: "", electionId: null };

const readItem = (dir: string, id: string): QueueItem | null => {
  const p = join(dir, `${id}.json`);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as QueueItem) : null;
};
const listDir = (dir: string): QueueItem[] =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8"))) : [];

function reviewer(): string {
  const fromFlag = typeof args.reviewer === "string" ? args.reviewer : "";
  if (fromFlag) return fromFlag;
  try {
    return execSync("git config user.name", { encoding: "utf8" }).trim() || "desconocido";
  } catch {
    return "desconocido";
  }
}

function requireTty(action: string): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new AppError("REQUIRES_TTY", {
      name: "RequiresTty",
      human: `${action} requiere una terminal interactiva.`,
      hint: "Aprobar publica una afirmación sobre una persona: lo hace el revisor humano, en su terminal. No existe --yes.",
    });
  }
}

// ---------------------------------------------------------------- validation

function validate(p: Partial<Proposal>, ds: ReturnType<typeof load>, domains: string[]): string[] {
  const errs: string[] = [];
  for (const k of ["candidateId", "category", "summary", "legalStatus", "url", "publisher", "quote", "identityEvidence", "proposedBy"] as const) {
    if (typeof p[k] !== "string" || !(p[k] as string).trim()) errs.push(`falta ${k}`);
  }
  if (p.category && !CATEGORIES.includes(p.category)) errs.push(`category inválida: ${p.category}`);
  if (p.legalStatus && !LEGAL.includes(p.legalStatus)) errs.push(`legalStatus inválido: ${p.legalStatus}`);
  if (p.candidateId && !ds.candidates.has(p.candidateId)) errs.push(`candidato desconocido: ${p.candidateId}`);
  if (p.date && !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) errs.push("date debe ser YYYY-MM-DD");
  if (p.quote && p.quote.length > 600) errs.push("quote demasiado larga (máx. 600): cita un fragmento");
  if (p.url) {
    try {
      const host = new URL(p.url).hostname.replace(/^www\./, "");
      if (!domains.some((d) => host === d || host.endsWith(`.${d}`))) errs.push(`dominio fuera de la lista blanca: ${host}`);
    } catch {
      errs.push(`url inválida: ${p.url}`);
    }
  }
  return errs;
}

const htmlToText = (html: string) =>
  html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(Number.parseInt(n, 16)))
    // Named Latin entities (&iacute;, &ntilde;, &Uuml;...): keep the base letter;
    // the comparison drops accents anyway.
    .replace(/&([a-z])(acute|grave|circ|uml|tilde|cedil|ring);/gi, "$1")
    .replace(/&(laquo|raquo|ldquo|rdquo|lsquo|rsquo|ndash|mdash|hellip);/g, " ");

async function check(p: Proposal): Promise<QueueItem["check"]> {
  const domain = new URL(p.url).hostname.replace(/^www\./, "");
  let fetched = false;
  let httpStatus: number | null = null;
  let quoteVerified = false;
  let sha256: string | null = null;
  let note = "";
  try {
    const res = await fetch(p.url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(20000) });
    httpStatus = res.status;
    const html = await res.text();
    if (res.ok) {
      fetched = true;
      sha256 = createHash("sha256").update(html).digest("hex");
      // Compare accent-, case-, punctuation- and whitespace-insensitively:
      // outlets re-encode quotes and dashes, and split words with inline tags
      // ("públic<span>a</span>"), so spaces carry no signal. The letters
      // themselves must still appear in the same exact sequence.
      const squash = (t: string) => fold(t).replace(/ /g, "");
      quoteVerified = squash(htmlToText(html)).includes(squash(p.quote));
      note = quoteVerified ? "cita encontrada en la página" : "la cita NO aparece en la página";
      if (!quoteVerified) {
        // Some outlets ship the article body as JSON inside a <script> and
        // render it client-side. Look there too, with JSON escapes undone.
        const embedded = html
          .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(Number.parseInt(h, 16)))
          .replace(/\\[rnt]/g, " ")
          .replace(/\\"/g, '"');
        if (squash(htmlToText(embedded.replace(/<\/?script[^>]*>/gi, " "))).includes(squash(p.quote))) {
          quoteVerified = true;
          note = "cita encontrada en el cuerpo del artículo embebido en la página (JSON)";
        }
      }
    } else {
      note = `la página respondió HTTP ${res.status}; la cita no se pudo verificar`;
    }
  } catch (e) {
    note = `no se pudo descargar la página (${(e as Error).message}); la cita no se pudo verificar`;
  }
  let archivedUrl: string | null = null;
  try {
    const res = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(p.url)}`, { signal: AbortSignal.timeout(15000) });
    const body = (await res.json()) as { archived_snapshots?: { closest?: { url?: string; available?: boolean } } };
    archivedUrl = body.archived_snapshots?.closest?.available ? (body.archived_snapshots.closest.url ?? null) : null;
  } catch {
    archivedUrl = null;
  }
  return { domain, fetched, httpStatus, quoteVerified, sha256, archivedUrl, note };
}

// ---------------------------------------------------------------- commands

async function queueAdd(): Promise<number> {
  const file = args._[2];
  if (!file) throw usage("Falta el archivo de propuestas.", "votape-dev queue add propuestas.json");
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Proposal> | Partial<Proposal>[];
  const proposals = Array.isArray(raw) ? raw : [raw];
  const ds = load();
  const domains = ds.providers.find((p) => p.id === "prensa")?.domains ?? [];
  const known = new Set([...listDir(QUEUE), ...listDir(APPROVED), ...listDir(REJECTED)].map((i) => i.id));

  const results: { id: string | null; candidate: string; outcome: "queued" | "duplicate" | "invalid" | "rejected"; detail: string }[] = [];
  for (const p of proposals) {
    const name = (p.candidateId && ds.candidates.get(p.candidateId)?.name) || p.candidateId || "?";
    const errs = validate(p, ds, domains);
    if (errs.length) {
      results.push({ id: null, candidate: name, outcome: "invalid", detail: errs.join("; ") });
      continue;
    }
    const prop = p as Proposal;
    const id = `press-${createHash("sha1").update(`${prop.candidateId}|${prop.url}|${fold(prop.quote)}`).digest("hex").slice(0, 10)}`;
    if (known.has(id)) {
      results.push({ id, candidate: name, outcome: "duplicate", detail: "ya estaba en cola, aprobada o rechazada" });
      continue;
    }
    const c = await check(prop);
    const item: QueueItem = { id, proposal: prop, queuedAt: new Date().toISOString(), check: c };
    // A fetched page that does not contain the quote is a fabricated or
    // misremembered citation: it never reaches a human reviewer.
    if (c.fetched && !c.quoteVerified) {
      item.decision = { by: "votape-dev (automático)", at: item.queuedAt, reason: "QUOTE_NOT_FOUND" };
      if (!dryRun) atomicWriteJson(join(REJECTED, `${id}.json`), item);
      results.push({ id, candidate: name, outcome: "rejected", detail: c.note });
    } else {
      if (!dryRun) atomicWriteJson(join(QUEUE, `${id}.json`), item);
      results.push({ id, candidate: name, outcome: "queued", detail: c.note });
    }
    known.add(id);
  }
  const counts = results.reduce<Record<string, number>>((a, r) => ((a[r.outcome] = (a[r.outcome] ?? 0) + 1), a), {});
  return respond(ctx, { dryRun, counts, results }, [{ command: "bun run votape-dev review", description: "Revisar la cola (en una terminal)" }], (d) =>
    [
      `\n  ${bold(dryRun ? "Simulación (nada se escribió)" : "Propuestas procesadas")}  ${muted(JSON.stringify(d.counts))}\n`,
      ...d.results.map((r) => `  ${r.outcome === "queued" ? ok("en cola ") : r.outcome === "duplicate" ? muted("repetida") : warn(r.outcome === "invalid" ? "inválida" : "rechazada")}  ${r.candidate}  ${muted(r.detail)}`),
    ].join("\n"),
  );
}

function queueList(): number {
  const ds = load();
  const items = listDir(QUEUE).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  const rows = items.map((i) => ({ id: i.id, candidate: ds.candidates.get(i.proposal.candidateId)?.name ?? i.proposal.candidateId, summary: i.proposal.summary, publisher: i.proposal.publisher, quoteVerified: i.check.quoteVerified }));
  return respond(ctx, { total: rows.length, results: rows }, [{ command: "bun run votape-dev review", description: "Revisar (en una terminal)" }], (d) =>
    [`\n  ${bold(`${d.total} propuestas pendientes`)}\n`, ...d.results.map((r) => `  ${muted(r.id)}  ${r.quoteVerified ? ok("✓ cita") : warn("? cita")}  ${bold(r.candidate)} — ${r.summary} ${muted(`(${r.publisher})`)}`)].join("\n"),
  );
}

function factFile(c: Candidate): string {
  return join(ROOT, "data/elections", c.electionId, "facts", `${c.id}.json`);
}

function approve(item: QueueItem, edits: { summary?: string; legalStatus?: LegalStatus }, by: string): Fact {
  const ds = load();
  const c = ds.candidates.get(item.proposal.candidateId);
  if (!c) throw usage(`El candidato ${item.proposal.candidateId} ya no existe en los datos.`);
  const p = item.proposal;
  const at = new Date().toISOString();
  const source: Source = {
    id: `src-${item.id}`,
    providerId: "prensa",
    url: p.url,
    ...(item.check.archivedUrl ? { archivedUrl: item.check.archivedUrl } : {}),
    ...(item.check.sha256 ? { sha256: item.check.sha256 } : {}),
    accessedAt: item.queuedAt,
    publisher: p.publisher,
    ...(p.title ? { title: p.title } : {}),
    extractedBy: "agent",
  };
  const fact: Fact = {
    id: item.id,
    category: p.category,
    summary: edits.summary ?? p.summary,
    evidence: "prensa",
    legalStatus: edits.legalStatus ?? p.legalStatus,
    ...(p.date ? { date: p.date } : {}),
    details: { medio: p.publisher, titulo: p.title ?? null },
    quote: p.quote,
    quoteVerified: item.check.quoteVerified,
    identityEvidence: p.identityEvidence,
    sourceIds: [source.id],
    needsReview: false,
    reviewedBy: by,
    reviewedAt: at,
  };

  const audit = beginAudit(AUDIT, { kind: "review", command: "approve", meta: { item: item.id, candidate: c.id, url: p.url } });
  if (dryRun) {
    audit.dryRun({ fact: fact.id });
    return fact;
  }
  try {
    const file = factFile(c);
    const current: ExtraFacts = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { candidateId: c.id, facts: [], sources: [] };
    current.facts = [...current.facts.filter((f) => f.id !== fact.id), fact];
    current.sources = [...current.sources.filter((s) => s.id !== source.id), source];
    atomicWriteJson(file, current);
    item.decision = { by, at };
    atomicWriteJson(join(APPROVED, `${item.id}.json`), item);
    renameSync(join(QUEUE, `${item.id}.json`), join(QUEUE, `${item.id}.json.done`));
    audit.complete({ fact: fact.id, file });
    return fact;
  } catch (e) {
    audit.fail({ error: (e as Error).message });
    throw e;
  }
}

function reject(item: QueueItem, reason: string, by: string): void {
  const audit = beginAudit(AUDIT, { kind: "review", command: "reject", meta: { item: item.id, reason } });
  if (dryRun) return audit.dryRun();
  item.decision = { by, at: new Date().toISOString(), reason };
  atomicWriteJson(join(REJECTED, `${item.id}.json`), item);
  renameSync(join(QUEUE, `${item.id}.json`), join(QUEUE, `${item.id}.json.done`));
  audit.complete();
}

function getItem(): QueueItem {
  const id = args._[2];
  if (!id) throw usage("Falta el id de la propuesta.", "votape-dev queue list");
  const item = readItem(QUEUE, id);
  if (!item) throw new AppError("NOT_FOUND", { name: "NotFound", human: `No hay una propuesta pendiente con id ${id}.`, hint: "votape-dev queue list" });
  return item;
}

function renderItem(item: QueueItem, c: Candidate | undefined, n: number, total: number): string {
  const p = item.proposal;
  const ds = load();
  const j = c ? ds.jurisdictions.get(`${c.electionId}:${c.jurisdictionId}`) : undefined;
  return [
    `\n${muted(`── ${n}/${total} · ${item.id} ──────────────────────────────`)}`,
    `  ${bold(c?.name ?? p.candidateId)} ${muted(`· ${c?.party.name ?? "?"} · ${j?.name ?? "?"} · ${c?.age ?? "?"} años`)}`,
    "",
    `  ${bold("Afirmación propuesta:")} ${p.summary}`,
    `  ${muted("Categoría:")} ${p.category}   ${muted("Estado legal:")} ${p.legalStatus}   ${muted("Fecha:")} ${p.date ?? "—"}`,
    "",
    `  ${bold("Cita textual")} ${item.check.quoteVerified ? ok("(verificada en la página)") : warn(`(${item.check.note})`)}`,
    `  “${p.quote}”`,
    "",
    `  ${bold("¿Es la misma persona?")} ${p.identityEvidence}`,
    `  ${muted("Fuente:")} ${p.publisher}${p.title ? ` — ${p.title}` : ""}`,
    `  ${info(p.url)}`,
    item.check.archivedUrl ? `  ${muted("Archivo:")} ${info(item.check.archivedUrl)}` : `  ${muted("Archivo: sin copia en Wayback")}`,
    `  ${muted(`Propuesto por ${p.proposedBy}`)}`,
  ].join("\n");
}

async function reviewInteractive(): Promise<number> {
  requireTty("La revisión");
  const ds = load();
  const items = listDir(QUEUE).sort((a, b) => a.proposal.candidateId.localeCompare(b.proposal.candidateId) || a.queuedAt.localeCompare(b.queuedAt));
  if (!items.length) {
    process.stderr.write("No hay propuestas pendientes.\n");
    return 0;
  }
  const by = reviewer();
  process.stderr.write(`${bold(`${items.length} propuestas`)} · revisor: ${by}${dryRun ? warn(" · SIMULACIÓN") : ""}\n`);
  process.stderr.write(muted("Antes de aprobar: abre la fuente, confirma que es la misma persona y que el resumen no dice más que la cita.\n"));
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const tally = { aprobadas: 0, rechazadas: 0, saltadas: 0 };
  try {
    for (const [i, item] of items.entries()) {
      process.stderr.write(`${renderItem(item, ds.candidates.get(item.proposal.candidateId), i + 1, items.length)}\n`);
      for (;;) {
        const a = (await rl.question(`\n  [a]probar · [e]ditar y aprobar · [r]echazar · [s]altar · [q] salir > `)).trim().toLowerCase();
        if (a === "a") {
          approve(item, {}, by);
          tally.aprobadas++;
          break;
        }
        if (a === "e") {
          const summary = (await rl.question(`  Nuevo resumen [${item.proposal.summary}]: `)).trim() || undefined;
          const ls = (await rl.question(`  Estado legal ${LEGAL.join("/")} [${item.proposal.legalStatus}]: `)).trim() as LegalStatus;
          if (ls && !LEGAL.includes(ls)) {
            process.stderr.write(warn("  Estado legal inválido.\n"));
            continue;
          }
          approve(item, { summary, legalStatus: ls || undefined }, by);
          tally.aprobadas++;
          break;
        }
        if (a === "r") {
          const reason = (await rl.question("  Motivo: ")).trim();
          if (!reason) {
            process.stderr.write(warn("  El motivo es obligatorio.\n"));
            continue;
          }
          reject(item, reason, by);
          tally.rechazadas++;
          break;
        }
        if (a === "s") {
          tally.saltadas++;
          break;
        }
        if (a === "q") {
          process.stderr.write(`\n${JSON.stringify(tally)}\n`);
          return 0;
        }
      }
    }
  } finally {
    rl.close();
  }
  process.stderr.write(`\n${ok("Listo.")} ${JSON.stringify(tally)}${dryRun ? " (simulación)" : ""}\n`);
  if (tally.aprobadas && !dryRun) process.stderr.write(muted("Siguiente: bun run build && bun test, luego commit de data/elections/*/facts/\n"));
  return 0;
}

async function main(): Promise<number> {
  const [noun, verb] = args._;
  try {
    mkdirSync(QUEUE, { recursive: true });
    if (noun === "queue" && verb === "add") return await queueAdd();
    if (noun === "queue" && verb === "list") return queueList();
    if (noun === "review" && !verb) return await reviewInteractive();
    if (noun === "review" && verb === "approve") {
      requireTty("Aprobar");
      const item = getItem();
      const ls = typeof args.legalStatus === "string" ? (args.legalStatus as LegalStatus) : undefined;
      if (ls && !LEGAL.includes(ls)) throw usage(`legal-status inválido: ${ls}`);
      const fact = approve(item, { summary: typeof args.summary === "string" ? args.summary : undefined, legalStatus: ls }, reviewer());
      return respond(ctx, { dryRun, fact }, [], (d) => `${ok("✓")} ${d.dryRun ? "(simulación) " : ""}aprobada ${d.fact.id}`);
    }
    if (noun === "review" && verb === "reject") {
      const reason = typeof args.reason === "string" ? args.reason.trim() : "";
      if (!reason) throw usage("El motivo es obligatorio.", 'votape-dev review reject <id> --reason "homónimo"');
      const item = getItem();
      reject(item, reason, reviewer());
      return respond(ctx, { dryRun, id: item.id, rejected: true }, [], () => `${ok("✓")} ${dryRun ? "(simulación) " : ""}rechazada ${item.id}`);
    }
    throw usage("Comando desconocido.", "votape-dev queue add <file> | queue list | review | review approve <id> | review reject <id> --reason <texto>");
  } catch (err) {
    return fail(ctx, err);
  }
}

process.exitCode = await main();

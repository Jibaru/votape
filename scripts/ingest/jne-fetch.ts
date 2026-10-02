// Stage 1 of the JNE ingest: download raw Voto Informado responses into .cache/.
//
// The raw responses carry DNI, birth date, addresses and plates, so they never
// leave .cache/ (gitignored). jne-normalize.ts reads them and writes the public
// JSON under data/. Each cached file keeps the request URL, body and timestamp
// so a normalized Source can point at exactly what was fetched.
//
// Usage: bun run scripts/ingest/jne-fetch.ts [--only-lima-metro] [--refresh]

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgv } from "../../src/lib/foundation/argv.js";

const BASE = "https://votoinformado.jne.gob.pe/api/v1";
const UA = "votape/0.1 (+https://github.com/Jibaru/votape; datos públicos del JNE)";
const DELAY_MS = 350;
const CACHE = join(process.cwd(), ".cache/jne/erm-2026");

// Lima Metropolitana in JNE codes (not INEI): dep 14, pro 01.
const DEP = "14";
const PRO = "01";

export type CachedResponse<T = unknown> = {
  url: string;
  method: "GET" | "POST";
  body?: unknown;
  fetchedAt: string;
  sha256: string;
  data: T;
};

/** JNE idTipoEleccion: 5 = municipal provincial, 6 = municipal distrital. */
const raceType = (scopeId: string) => (scopeId === "00" ? 5 : 6);

const args = parseArgv();
const refresh = Boolean(args.refresh);
let calls = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchCached<T>(
  file: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<CachedResponse<T>> {
  const target = join(CACHE, file);
  if (!refresh && existsSync(target)) {
    return JSON.parse(readFileSync(target, "utf8")) as CachedResponse<T>;
  }
  const url = `${BASE}${path}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    await sleep(DELAY_MS * attempt);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "User-Agent": UA,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      calls++;
      const text = await res.text();
      // The JNE answers "not available" (e.g. a missing plan) as 404 with a
      // JSON body. That is an answer, not a failure: cache it, don't retry.
      if (!res.ok && !(res.status === 404 && text.startsWith("{"))) {
        throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 120)}`);
      }
      const data = JSON.parse(text) as T;
      const cached: CachedResponse<T> = {
        url,
        method,
        ...(body ? { body } : {}),
        fetchedAt: new Date().toISOString(),
        sha256: createHash("sha256").update(text).digest("hex"),
        data,
      };
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, JSON.stringify(cached));
      return cached;
    } catch (err) {
      lastErr = err;
      process.stderr.write(`  retry ${attempt}/4: ${(err as Error).message}\n`);
    }
  }
  throw lastErr;
}

type Envelope<T> = { success: boolean; message: string; data: T };
type Org = {
  idOrganizacionPolitica: number;
  organizacionPolitica: string;
  listas: { idSolicitudLista: number; codigoExpediente: string; rutaPlanGobierno: string | null }[];
};
type OrgGroup = { idTipoEleccion: number; tipoEleccion: string; organizaciones: Org[] };
type CandGroup = {
  organizaciones: {
    listas: { candidatos?: { idHojaVida: string | null; cargoEleccion: string }[] }[];
  }[];
};

async function main() {
  const districts = await fetchCached<{ id: string; nombre: string }[]>(
    "districts.json",
    "GET",
    `/departamentos/${DEP}/provincias/${PRO}/distritos`,
  );

  // "00" is the provincial race (Lima Metropolitana); the rest are districts.
  const scopes = [{ id: "00", nombre: "LIMA METROPOLITANA" }, ...districts.data];
  const selected = args.onlyLimaMetro ? scopes.slice(0, 1) : scopes;

  let mayors = 0;
  for (const [i, scope] of selected.entries()) {
    const sel = { dep: DEP, pro: PRO, dis: scope.id };
    const orgs = await fetchCached<Envelope<OrgGroup[]>>(
      `scopes/${scope.id}/organizaciones.json`,
      "POST",
      "/candidatos/organizaciones",
      sel,
    );
    // A district query also returns the provincial lists (the voter gets both
    // ballots). Keep only the race this scope is about.
    const lists = orgs.data.data
      .filter((g) => g.idTipoEleccion === raceType(scope.id))
      .flatMap((g) => g.organizaciones.flatMap((o) => o.listas));
    process.stderr.write(`[${i + 1}/${selected.length}] ${scope.nombre}: ${lists.length} listas\n`);

    for (const list of lists) {
      const cands = await fetchCached<Envelope<CandGroup[]>>(
        `scopes/${scope.id}/listas/${list.idSolicitudLista}.json`,
        "POST",
        "/candidatos/organizaciones/candidatos",
        { ...sel, idSolicitudLista: list.idSolicitudLista },
      );
      const people = (cands.data.data ?? []).flatMap((g) =>
        g.organizaciones.flatMap((o) => o.listas.flatMap((l) => l.candidatos ?? [])),
      );
      // A mayor who resigned comes back with idHojaVida null: nothing to fetch.
      for (const c of people.filter((p) => p.idHojaVida && p.cargoEleccion?.startsWith("ALCALDE"))) {
        await fetchCached(`hojas-vida/${c.idHojaVida}.json`, "GET", `/candidatos/hoja-vida/${c.idHojaVida}`);
        mayors++;
      }
      await fetchCached(
        `planes/${list.codigoExpediente}.json`,
        "GET",
        `/plan-gobierno/resumen?codigoExpediente=${encodeURIComponent(list.codigoExpediente)}`,
      );
    }
  }
  process.stderr.write(`listo: ${mayors} hojas de vida de alcaldes, ${calls} llamadas nuevas\n`);
}

await main();

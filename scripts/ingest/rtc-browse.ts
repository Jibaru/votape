// RTC (revisatucandidato.pe) ingest, stage 1: browse each mayoral profile the
// way a person would, keep the visible text of the relevant tabs and a
// screenshot of each as evidence. Everything lands in .cache/rtc/ (the
// screenshots show DNI and photo, so they are never published).
//
// Decision Q22b (PLAN.md): the user chose to browse and publish RTC data
// before the consortium answers. The profile modal is rendered by RTC's own
// client code, which calls their /api/; we never call it directly.
//
// Usage: bun run scripts/ingest/rtc-browse.ts [--limit N] [--only <idHojaVida>] [--refresh]

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgv } from "../../src/lib/foundation/argv.js";

const ROOT = join(import.meta.dir, "../..");
const CACHE = join(ROOT, ".cache/rtc");
const SHOTS = join(CACHE, "shots");
const PROFILES = join(CACHE, "profiles");
const JNE_HV = join(ROOT, ".cache/jne/erm-2026/hojas-vida");
const DATA = join(ROOT, "data/elections/erm-2026");
const BASE = "https://revisatucandidato.pe";
const UA = "Mozilla/5.0 (votape; +https://github.com/Jibaru/votape)";
const PROFILE_DELAY_MS = 3000;
const TABS = ["Contratos con el Estado", "Deudas y obligaciones", "Sanciones", "Trayectoria política"] as const;

const args = parseArgv(process.argv.slice(2), new Set(["refresh"]));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
/** RTC's district slug: lowercase, accents dropped, but ñ kept ("breña", not "brena"). */
const rtcDistrict = (s: string) => s.toLowerCase().replace(/ñ/g, "#").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/#/g, "ñ").trim();

export type RtcProfile = {
  candidateId: string;
  rtcId: number;
  name: string;
  profileUrl: string;
  fetchedAt: string;
  tabs: Record<string, { text: string; screenshot: string; sha256: string }>;
};

// ---------------------------------------------------------------- agent-browser

function ab(...a: string[]): string {
  const p = Bun.spawnSync(["agent-browser", ...a], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`agent-browser ${a[0]} falló: ${p.stderr.toString().slice(0, 200)}`);
  return p.stdout.toString();
}

function refFor(snapshot: string, exactName: string): string | null {
  const esc = exactName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return snapshot.match(new RegExp(`button "${esc}" \\[ref=(e\\d+)\\]`))?.[1] ?? null;
}

// ---------------------------------------------------------------- RTC ids

/** Astro serializes island props as [type, value] pairs: 0 = plain, 1 = array. */
// biome-ignore lint/suspicious/noExplicitAny: decoding an untyped wire format
function devalue(v: any): any {
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === "number") {
    if (v[0] === 0) return devalue(v[1]);
    if (v[0] === 1) return (v[1] as unknown[]).map(devalue);
    return v[1];
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, devalue(x)]));
  }
  return v;
}

type RtcCand = { id: number; dni: string; name: string; listUrl: string };

const decodeProps = (raw: string) =>
  devalue(JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")));

/**
 * List URLs for every mayoral race visible from a district page. The page only
 * previews a few candidates per race; the full set appears after pressing
 * "Ver los N candidatos", as a person would, and is read from that dialog.
 */
function raceListUrls(district: string): string[] {
  const q = new URLSearchParams({ region: "lima", provincia: "lima", distrito: district });
  ab("open", `${BASE}/elecciones-regionales-municipales/candidatos?${q}`);
  ab("wait", "2000");
  const refs = [...ab("snapshot").matchAll(/button "Ver ?los \d+ candidatos" \[ref=(e\d+)\]/g)].map((m) => m[1] as string);
  const urls: string[] = [];
  for (const ref of refs) {
    ab("click", `@${ref}`);
    ab("wait", "[role=dialog]");
    ab("wait", "1000");
    const out = ab("eval", "JSON.stringify([...document.querySelectorAll('[role=dialog] a')].map(a=>a.getAttribute('href')))");
    const hrefs = JSON.parse(JSON.parse(out.trim())) as (string | null)[];
    urls.push(...hrefs.filter((h): h is string => Boolean(h?.includes("cargo=alcalde"))));
    ab("press", "Escape");
    ab("wait", "500");
  }
  return urls;
}

/** The list page is server-rendered (allowed by robots.txt) and names its head candidate. */
async function listHead(listUrl: string): Promise<RtcCand | null> {
  const html = await (await fetch(`${BASE}${listUrl}`, { headers: { "User-Agent": UA } })).text();
  const m = html.match(/component-url="\/_astro\/ErmPartyList[^"]*"[^>]*props="([^"]+)"/);
  if (!m?.[1]) return null;
  // biome-ignore lint/suspicious/noExplicitAny: decoded wire format
  const head = (decodeProps(m[1]).members ?? []).find((x: any) => /^alcalde/i.test(x.role ?? ""));
  return head ? { id: head.candidate.id, dni: String(head.candidate.dni), name: head.name, listUrl } : null;
}

/** DNI → idHojaVida, from the private JNE cache. The DNI never leaves .cache. */
function dniIndex(): Map<string, string> {
  const idx = new Map<string, string>();
  for (const f of readdirSync(JNE_HV)) {
    const d = JSON.parse(readFileSync(join(JNE_HV, f), "utf8"))?.data?.data?.datoGeneral;
    if (d?.numeroDocumento && d?.idHojaVida) idx.set(String(d.numeroDocumento).trim(), d.idHojaVida);
  }
  return idx;
}

// ---------------------------------------------------------------- browse

async function browse(c: RtcCand, candidateId: string): Promise<RtcProfile> {
  const profileUrl = `${BASE}${c.listUrl}&candidato=${c.id}`;
  ab("open", profileUrl);
  ab("wait", "[role=dialog]");
  ab("wait", "1500");
  const tabs: RtcProfile["tabs"] = {};
  for (const tab of TABS) {
    const ref = refFor(ab("snapshot"), tab);
    if (!ref) throw new Error(`no encontré la pestaña "${tab}"`);
    ab("click", `@${ref}`);
    ab("wait", "800");
    const full = ab("get", "text", "[role=dialog]");
    // The dialog repeats the tab strip; the panel starts after the last tab label.
    const i = full.lastIndexOf("Experiencia profesional");
    const text = (i >= 0 ? full.slice(i + "Experiencia profesional".length) : full).replace(/\nCerrar\s*$/, "").trim();
    const shot = join(SHOTS, `${c.id}-${fold(tab).replace(/[^a-z]+/g, "-")}.png`);
    ab("screenshot", shot);
    tabs[tab] = { text, screenshot: shot.replace(`${ROOT}/`, ""), sha256: createHash("sha256").update(readFileSync(shot)).digest("hex") };
  }
  return { candidateId, rtcId: c.id, name: c.name, profileUrl, fetchedAt: new Date().toISOString(), tabs };
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(PROFILES, { recursive: true });
  const byDni = dniIndex();
  const jurisdictions = readdirSync(join(DATA, "jurisdictions")).map((f) => JSON.parse(readFileSync(join(DATA, "jurisdictions", f), "utf8")));

  // 1. RTC ids: race dialogs (browser) → list pages (server-rendered HTML).
  const listsFile = join(CACHE, "lists.json");
  const cachedLists: string[] = existsSync(listsFile) && !args.refresh ? JSON.parse(readFileSync(listsFile, "utf8")) : [];
  const set = new Set<string>(cachedLists);
  const slugOf = (j: { id: string; name: string }) => (j.id === "140101" ? "lima" : rtcDistrict(j.name));
  // Districts with no district-level list yet (first run, or a slug that failed before).
  const pending = jurisdictions.filter(
    (x) => x.level === "distrital" && ![...set].some((u) => u.includes("cargo=alcalde-distrital") && new URLSearchParams(u.split("?")[1]).get("distrito") === slugOf(x)),
  );
  if (pending.length) {
    for (const j of pending) {
      const name = slugOf(j);
      const urls = raceListUrls(name);
      if (!urls.length) process.stderr.write(`  sin listas en RTC para ${j.name}\n`);
      for (const u of urls) {
        // The provincial race shows up on every district page under a
        // different URL; keep one per organization.
        const prov = u.includes("cargo=alcalde-provincial");
        const org = new URLSearchParams(u.split("?")[1]).get("organizacion");
        if (prov && [...set].some((x) => x.includes("cargo=alcalde-provincial") && x.endsWith(`organizacion=${org}`))) continue;
        set.add(u);
      }
      process.stderr.write(`  ${j.name}: ${urls.length} listas\n`);
    }
    writeFileSync(listsFile, JSON.stringify([...set], null, 2));
  }
  const listUrls = [...set];
  const rtc = new Map<number, RtcCand>();
  const headsFile = join(CACHE, "heads.json");
  const cachedHeads: Record<string, RtcCand | null> = existsSync(headsFile) ? JSON.parse(readFileSync(headsFile, "utf8")) : {};
  for (const u of listUrls) {
    if (!(u in cachedHeads)) {
      cachedHeads[u] = await listHead(u);
      await sleep(800);
    }
    const h = cachedHeads[u];
    if (h) rtc.set(h.id, h);
  }
  writeFileSync(headsFile, JSON.stringify(cachedHeads));

  // 2. Exact match by DNI against our candidates.
  const targets: { c: RtcCand; candidateId: string }[] = [];
  let unmatched = 0;
  for (const c of rtc.values()) {
    const candidateId = byDni.get(c.dni);
    if (candidateId) targets.push({ c, candidateId });
    else unmatched++;
  }
  process.stderr.write(`RTC: ${rtc.size} candidatos a alcalde, ${targets.length} cruzados por DNI, ${unmatched} sin cruce\n`);

  // 3. Browse profiles, slowly; resumable through the cache.
  let todo = targets.filter(({ candidateId }) => args.refresh || !existsSync(join(PROFILES, `${candidateId}.json`)));
  if (typeof args.only === "string") todo = todo.filter((t) => t.candidateId === args.only);
  if (args.limit) todo = todo.slice(0, Number(args.limit));
  for (const [i, { c, candidateId }] of todo.entries()) {
    try {
      const profile = await browse(c, candidateId);
      writeFileSync(join(PROFILES, `${candidateId}.json`), JSON.stringify(profile, null, 2));
      process.stderr.write(`[${i + 1}/${todo.length}] ${c.name}\n`);
    } catch (e) {
      process.stderr.write(`[${i + 1}/${todo.length}] ${c.name}: ERROR ${(e as Error).message}\n`);
    }
    await sleep(PROFILE_DELAY_MS);
  }
}

await main();

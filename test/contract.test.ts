// Agent-first rules (cli-build) and the data guarantees `votape schema`
// promises, checked against the built binary and the bundled data.
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Candidate } from "../src/model.js";

const BIN = join(import.meta.dir, "../dist/cli.js");
const DATA = join(import.meta.dir, "../data/elections");

function run(...args: string[]) {
  const p = Bun.spawnSync(["node", BIN, ...args], { env: { ...process.env, NO_COLOR: "", FORCE_COLOR: "" } });
  return { code: p.exitCode, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
}

const candidates: Candidate[] = readdirSync(DATA).flatMap((e) =>
  readdirSync(join(DATA, e, "candidates")).map((f) => JSON.parse(readFileSync(join(DATA, e, "candidates", f), "utf8"))),
);

beforeAll(() => {
  expect(Bun.spawnSync(["bun", "run", "scripts/build.ts"], { cwd: join(import.meta.dir, "..") }).exitCode).toBe(0);
});

describe("agent-first rules", () => {
  test("piped stdout is JSON without --json", () => {
    const r = run("jurisdiction", "list");
    expect(r.code).toBe(0);
    const body = JSON.parse(r.stdout);
    expect(body.ok).toBe(true);
    expect(body.meta.schemaVersion).toBeString();
  });

  test("piped output carries no ANSI escapes, on stdout or stderr", () => {
    for (const args of [[], ["bruce"], ["candidate", "get", "nadie-se-llama-asi"]]) {
      const r = run(...args);
      expect(r.stdout + r.stderr).not.toMatch(/\x1b\[/);
    }
  });

  test("bare invoke: exit 0, stdout is a parseable envelope, banner never on stdout", () => {
    const r = run();
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).data.commands.length).toBeGreaterThan(5);
  });

  test("schema exposes versions and every command", () => {
    const body = JSON.parse(run("schema").stdout);
    expect(body.data.schemaVersion).toBeString();
    expect(body.data.dataVersion).toBeString();
    expect(body.data.commands.map((c: { command: string }) => c.command).join(" ")).toContain("candidate get");
  });

  test("exit codes distinguish usage (2) from not found (4)", () => {
    const usage = run("candidate", "frobnicate");
    expect(usage.code).toBe(2);
    expect(JSON.parse(usage.stdout).error.code).toBe("USAGE");
    const missing = run("candidate", "get", "zzzzzzzzzz");
    expect(missing.code).toBe(4);
    expect(JSON.parse(missing.stdout).error.code).toBe("NOT_FOUND");
  });

  test("--json does not swallow the next positional", () => {
    const r = run("candidate", "search", "--json", "bruce");
    expect(JSON.parse(r.stdout).data.query).toBe("bruce");
  });

  test("success envelopes include nextSteps", () => {
    const body = JSON.parse(run("bruce").stdout);
    expect(Array.isArray(body.nextSteps)).toBe(true);
  });
});

describe("data guarantees", () => {
  test("there is data to check", () => {
    expect(candidates.length).toBeGreaterThan(20);
  });

  test("no DNI, birth date, photo or plate fields leak into published data", () => {
    const raw = readdirSync(DATA)
      .flatMap((e) => readdirSync(join(DATA, e, "candidates")).map((f) => readFileSync(join(DATA, e, "candidates", f), "utf8")))
      .join("\n");
    for (const key of ["numeroDocumento", "feNacimiento", "urlFoto", "placa", "inmuebleDireccion", "partidaSunarp", "txUsuario"]) {
      expect(raw).not.toContain(`"${key}"`);
    }
    expect(raw).not.toMatch(/\b\d{8}\.jpg\b/);
    expect(raw).not.toMatch(/D\.?\s?N\.?\s?I\.?[^0-9"]{0,15}\d{8}\b/i);
  });

  test("extra facts (press, RTC) carry no DNI, natural-person RUC or birth data", () => {
    for (const e of readdirSync(DATA)) {
      const dir = join(DATA, e, "facts");
      for (const f of existsSync(dir) ? readdirSync(dir) : []) {
        const raw = readFileSync(join(dir, f), "utf8");
        expect(raw).not.toMatch(/\b10\d{9}\b/);
        expect(raw).not.toMatch(/DNI:?\s*\d{8}\b/i);
        expect(raw).not.toMatch(/\b\d{8}\.jpg\b/);
      }
    }
  });

  test("civil obligation rulings are never copied (they name third parties)", () => {
    for (const c of candidates) {
      for (const f of c.facts.filter((x) => x.category === "civil_obligation")) expect(f.details.fallo).toBeNull();
    }
  });

  test("every fact cites a source the candidate file carries", () => {
    for (const c of candidates) {
      const ids = new Set(c.sources.map((s) => s.id));
      for (const f of c.facts) {
        expect(f.sourceIds.length).toBeGreaterThan(0);
        for (const id of f.sourceIds) expect(ids.has(id)).toBe(true);
      }
    }
  });

  test("each jurisdiction lists only its own race (districts once got the provincial lists too)", () => {
    for (const e of readdirSync(DATA)) {
      for (const f of readdirSync(join(DATA, e, "jurisdictions"))) {
        const j = JSON.parse(readFileSync(join(DATA, e, "jurisdictions", f), "utf8"));
        for (const c of j.candidacies) {
          if (!c.candidateId) continue;
          const cand = candidates.find((x) => x.id === c.candidateId);
          expect(cand?.jurisdictionId).toBe(j.id);
        }
      }
    }
  });

  test("facts awaiting review are not shown", () => {
    const pending = candidates.find((c) => c.facts.some((f) => f.needsReview));
    if (!pending) return;
    const body = JSON.parse(run("candidate", "get", pending.id).stdout);
    expect(body.data.facts.some((f: { needsReview: boolean }) => f.needsReview)).toBe(false);
  });
});

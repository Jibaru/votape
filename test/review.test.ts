// The review gate: proposals are validated before queueing, approval needs a
// human at a terminal, and --dry-run writes nothing.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const QUEUE = join(ROOT, ".cache/review/queue");

function dev(...args: string[]) {
  // Bun.spawnSync without a pty: stdin/stdout are pipes, exactly an agent's situation.
  const p = Bun.spawnSync(["bun", "run", "scripts/dev.ts", ...args, "--json"], { cwd: ROOT });
  return { code: p.exitCode, body: JSON.parse(p.stdout.toString() || "null") };
}

const queued = () => (existsSync(QUEUE) ? readdirSync(QUEUE).filter((f) => f.endsWith(".json")).length : 0);
const anyCandidate = () => readdirSync(join(ROOT, "data/elections/erm-2026/candidates"))[0]?.replace(".json", "") ?? "";

function proposalsFile(p: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), "votape-"));
  const f = join(dir, "p.json");
  writeFileSync(f, JSON.stringify(p));
  return f;
}

const base = {
  candidateId: anyCandidate(),
  category: "press_report",
  summary: "Según un medio, algo ocurrió.",
  legalStatus: "n/a",
  url: "https://example.com/nota",
  publisher: "Ejemplo",
  quote: "algo ocurrió",
  identityEvidence: "Coinciden nombre y cargo.",
  proposedBy: "test",
};

describe("votape-dev queue add", () => {
  test("rejects domains outside the whitelist, unknown candidates and bad enums, without network", () => {
    const before = queued();
    const r = dev(
      "queue",
      "add",
      proposalsFile([base, { ...base, url: "https://larepublica.pe/x", candidateId: "no-existe" }, { ...base, url: "https://rpp.pe/x", legalStatus: "culpable" }]),
    );
    expect(r.code).toBe(0);
    const outcomes = r.body.data.results.map((x: { outcome: string; detail: string }) => [x.outcome, x.detail]);
    expect(outcomes[0][0]).toBe("invalid");
    expect(outcomes[0][1]).toContain("lista blanca");
    expect(outcomes[1][1]).toContain("candidato desconocido");
    expect(outcomes[2][1]).toContain("legalStatus inválido");
    expect(queued()).toBe(before);
  });

  test("missing required fields are reported, not crashed on", () => {
    const r = dev("queue", "add", proposalsFile([{ candidateId: anyCandidate() }]));
    expect(r.body.data.results[0].outcome).toBe("invalid");
    expect(r.body.data.results[0].detail).toContain("falta quote");
  });
});

describe("approval gate", () => {
  test("approve refuses without a TTY (no --yes exists)", () => {
    const r = dev("review", "approve", "press-cualquiera");
    expect(r.code).toBe(2);
    expect(r.body.error.code).toBe("REQUIRES_TTY");
  });

  test("interactive review refuses without a TTY", () => {
    const r = dev("review");
    expect(r.code).toBe(2);
    expect(r.body.error.code).toBe("REQUIRES_TTY");
  });

  test("reject requires a reason", () => {
    const r = dev("review", "reject", "press-cualquiera");
    expect(r.code).toBe(2);
    expect(r.body.error.message).toContain("motivo");
  });
});

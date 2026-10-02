// Bundles the CLI for Node. Data stays as plain JSON files beside dist/, read
// at runtime, so a data-only release needs no code change.
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

const result = await Bun.build({
  entrypoints: ["src/cli.ts"],
  outdir: "dist",
  target: "node",
  format: "esm",
  minify: false,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const out = "dist/cli.js";
const code = readFileSync(out, "utf8").replace(/^#!.*\n/, "");
writeFileSync(out, `#!/usr/bin/env node\n${code}`);
chmodSync(out, 0o755);
console.error(`build ok → ${out}`);

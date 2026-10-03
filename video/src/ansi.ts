// Minimal SGR parser for the escape codes votape emits (bold, dim, underline,
// 256-color foreground). Lines become runs of styled text, and can be sliced by
// visible column so wide tables fit the vertical reel.

import { COLORS } from "./theme";

export type Style = { color?: string; bold?: boolean; dim?: boolean; underline?: boolean };
export type Run = { text: string; style: Style };
type Cell = { ch: string; style: Style };

const PALETTE_256: Record<number, string> = {
  114: COLORS.green,
  110: COLORS.blue,
  203: COLORS.red,
  214: COLORS.orange,
  245: COLORS.muted,
  238: COLORS.faint,
  255: COLORS.text,
};

function applySgr(style: Style, codes: number[]): Style {
  const s = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (c === 0) {
      delete s.color;
      delete s.bold;
      delete s.dim;
      delete s.underline;
    } else if (c === 1) s.bold = true;
    else if (c === 2) s.dim = true;
    else if (c === 4) s.underline = true;
    else if (c === 32) s.color = COLORS.green;
    else if (c === 38 && codes[i + 1] === 5) {
      s.color = PALETTE_256[codes[i + 2] ?? -1] ?? s.color;
      i += 2;
    }
  }
  return s;
}

function toCells(line: string): Cell[] {
  const cells: Cell[] = [];
  let style: Style = {};
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    for (const ch of line.slice(last, m.index)) cells.push({ ch, style });
    style = applySgr(style, (m[1] || "0").split(";").map(Number));
    last = re.lastIndex;
  }
  for (const ch of line.slice(last)) cells.push({ ch, style });
  return cells;
}

function toRuns(cells: Cell[]): Run[] {
  const runs: Run[] = [];
  for (const c of cells) {
    const prev = runs.at(-1);
    if (prev && JSON.stringify(prev.style) === JSON.stringify(c.style)) prev.text += c.ch;
    else runs.push({ text: c.ch, style: c.style });
  }
  return runs;
}

export function parseAnsi(
  text: string,
  opts: { columns?: [number, number][]; columnRows?: [number, number]; wrap?: number } = {},
): Run[][] {
  const out: Run[][] = [];
  for (const [row, line] of text.split("\n").entries()) {
    let cells = toCells(line);
    const inTable = !opts.columnRows || (row >= opts.columnRows[0] && row <= opts.columnRows[1]);
    if (opts.columns && inTable) {
      const src = cells;
      cells = opts.columns.flatMap(([a, b], k) => {
        const part = src.slice(a, b);
        // Cut mid-word: end with an ellipsis, as the CLI does for its own truncation.
        if (b < src.length && part.length && part.at(-1)?.ch !== " " && src[b]?.ch !== " ") {
          part[part.length - 1] = { ch: "…", style: part.at(-1)!.style };
        }
        return k < opts.columns!.length - 1 ? [...part, { ch: " ", style: {} }, { ch: " ", style: {} }] : part;
      });
      while (cells.length && cells.at(-1)?.ch === " ") cells.pop();
    }
    if (opts.wrap && cells.length > opts.wrap) {
      // Soft-wrap like a narrow terminal, keeping the line's indentation.
      const indent = cells.findIndex((c) => c.ch !== " ");
      const pad = Math.max(0, Math.min(indent, 8)) + 2;
      let first = true;
      while (cells.length) {
        const width = first ? opts.wrap : opts.wrap - pad;
        const chunk = cells.slice(0, width);
        cells = cells.slice(width);
        out.push(toRuns(first ? chunk : [...Array.from({ length: pad }, () => ({ ch: " ", style: {} })), ...chunk]));
        first = false;
      }
      continue;
    }
    out.push(toRuns(cells));
  }
  return out;
}

/** JSON syntax colouring for the `--json | jq` scene. */
export function parseJson(text: string): Run[][] {
  return text.split("\n").map((line) => {
    const runs: Run[] = [];
    const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(\b\d+\b)|([{}[\],])/g;
    let last = 0;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      if (m.index > last) runs.push({ text: line.slice(last, m.index), style: {} });
      if (m[1] && m[2]) {
        runs.push({ text: m[1], style: { color: COLORS.blue, bold: true } });
        runs.push({ text: m[2], style: { color: COLORS.muted } });
      } else if (m[1]) runs.push({ text: m[1], style: { color: COLORS.green } });
      else if (m[3]) runs.push({ text: m[3], style: { color: COLORS.orange } });
      else runs.push({ text: m[4] ?? "", style: { color: COLORS.muted } });
      last = re.lastIndex;
    }
    if (last < line.length) runs.push({ text: line.slice(last), style: {} });
    return runs;
  });
}

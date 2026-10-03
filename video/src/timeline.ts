// The single source of truth for both videos. Scenes, every keystroke and every
// sound cue are computed here; the React compositions draw them and
// scripts/audio.ts mixes the soundtrack from the same events, so picture and
// sound cannot drift apart.

import { CAPTURES } from "./captures.generated";

export const FPS = 30;
export type Format = "youtube" | "reel";

export type Sfx = "key" | "enter" | "whoosh" | "open" | "done" | "logo" | "glitch";
export type SfxEvent = { frame: number; sfx: Sfx; variant: number; gain: number };

export type TerminalCommand = {
  prompt: string;
  cmd: string;
  /** Absolute frame of each typed character. */
  charFrames: number[];
  enterFrame: number;
  outputFrame: number;
  output: string;
  /** Frames between revealed output lines. */
  linePace: number;
  /** For long output: scroll from top to bottom between these frames. */
  scroll?: { from: number; to: number };
  /** Reel only: keep these visible column ranges of the table rows. */
  columns?: [number, number][];
  /** Which output rows (0-based, inclusive) the column slicing applies to. */
  columnRows?: [number, number];
  wrap?: boolean;
  json?: boolean;
};

export type ClaudeScript = {
  question: string;
  charFrames: number[];
  submitFrame: number;
  toolCmd: string;
  toolStart: number;
  toolDone: number;
  answerStart: number;
  answer: string;
  answerCps: number;
};

export type Scene = {
  id: string;
  kind: "intro" | "terminal" | "claude" | "outro";
  from: number;
  duration: number;
  step?: string;
  caption?: string;
  windowTitle?: string;
  commands?: TerminalCommand[];
  claude?: ClaudeScript;
};

export type Timeline = { format: Format; scenes: Scene[]; sfx: SfxEvent[]; duration: number };

// Deterministic pseudo-random, so a re-render produces the same video and audio.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const ANSWER = [
  "En Miraflores postulan 9 candidaturas. Con antecedentes en fuentes públicas:",
  "",
  "• Jorge Muñoz Wells — el JNE oficializó su vacancia como alcalde de Lima (Infobae) y figuró en una investigación fiscal preliminar por una obra temporal (Epicentro). Es una investigación, no una condena.",
  "• Ricardo Giesecke — denunciado por la Fiscalía por presunto peculado en el Pronaa (RPP); él afirma que fue absuelto.",
  "• Mario Otiniano — declaró al JNE una sentencia por obligación.",
  "",
  "Fuentes: JNE, RPP, Infobae, Epicentro (votape fact list). Una denuncia o investigación no es una condena.",
].join("\n");

export function buildTimeline(format: Format): Timeline {
  const reel = format === "reel";
  const r = rng(reel ? 7 : 3);
  const sfx: SfxEvent[] = [];
  const scenes: Scene[] = [];
  let cursor = 0;

  const typeText = (text: string, start: number, speed = 1): number[] => {
    const frames: number[] = [];
    let f = start;
    for (const ch of text) {
      f += (ch === " " ? 2.2 : 1.1 + r() * 1.3) / speed;
      const frame = Math.round(f);
      frames.push(frame);
      sfx.push({ frame, sfx: "key", variant: Math.floor(r() * 5), gain: 0.55 + r() * 0.3 });
    }
    return frames;
  };

  const command = (
    sceneFrom: number,
    at: number,
    cmd: string,
    output: string,
    opts: Partial<Pick<TerminalCommand, "columns" | "columnRows" | "wrap" | "json" | "linePace">> & { hold?: number; scrollFrames?: number; speed?: number } = {},
  ): { c: TerminalCommand; end: number } => {
    const charFrames = typeText(cmd, sceneFrom + at, (reel ? 1.25 : 1) * (opts.speed ?? 1));
    const enterFrame = (charFrames.at(-1) ?? sceneFrom + at) + 8;
    sfx.push({ frame: enterFrame, sfx: "enter", variant: 0, gain: 0.9 });
    const outputFrame = enterFrame + 5;
    const linePace = opts.linePace ?? 1;
    const lines = output.split("\n").length;
    const revealed = outputFrame + lines * linePace;
    const scroll = opts.scrollFrames ? { from: revealed + 10, to: revealed + 10 + opts.scrollFrames } : undefined;
    const end = (scroll?.to ?? revealed) + (opts.hold ?? 45);
    return {
      c: { prompt: "~", cmd, charFrames, enterFrame, outputFrame, output, linePace, scroll, columns: opts.columns, columnRows: opts.columnRows, wrap: opts.wrap, json: opts.json },
      end,
    };
  };

  const pushScene = (s: Omit<Scene, "from" | "duration">, duration: number, transition: Sfx = "whoosh") => {
    scenes.push({ ...s, from: cursor, duration });
    if (cursor > 0) sfx.push({ frame: cursor, sfx: transition, variant: scenes.length % 3, gain: 0.5 });
    cursor += duration;
  };

  const terminalScene = (
    id: string,
    step: string,
    caption: string,
    build: (from: number) => { commands: TerminalCommand[]; end: number },
    transition: Sfx = "whoosh",
  ) => {
    const from = cursor;
    const { commands, end } = build(from);
    pushScene({ id, kind: "terminal", step, caption, windowTitle: "votape — zsh", commands }, end - from, transition);
  };

  // 1. Intro
  sfx.push({ frame: 8, sfx: "logo", variant: 0, gain: 0.8 });
  pushScene({ id: "intro", kind: "intro" }, reel ? 80 : 110);

  // 2. Install
  terminalScene(
    "install",
    "01",
    "Instala",
    (from) => {
      const { c, end } = command(from, 18, "npm i -g @jibaru/votape", CAPTURES.install, { hold: 40 });
      return { commands: [c], end };
    },
    "open",
  );

  // 3. Search
  terminalScene("search", "02", "Busca a un candidato", (from) => {
    const { c, end } = command(from, 14, "votape bruce", CAPTURES.search, {
      linePace: 2,
      hold: 55,
      columns: reel ? [[0, 28], [94, 150]] : undefined,
      columnRows: [3, 4],
      wrap: reel,
    });
    return { commands: [c], end };
  });

  // 4. District
  terminalScene("district", "03", "Explora tu distrito", (from) => {
    const { c, end } = command(from, 14, "votape jurisdiction get miraflores", CAPTURES.miraflores, {
      linePace: 2,
      hold: reel ? 70 : 80,
      columns: reel ? [[0, 28], [84, 150]] : undefined,
      columnRows: [3, 12],
      wrap: reel,
    });
    return { commands: [c], end };
  });

  // 5. Profile with sources
  terminalScene("profile", "04", "Antecedentes, con fuentes", (from) => {
    const { c, end } = command(from, 14, "votape candidate get urresti", CAPTURES.urresti, {
      linePace: 1,
      hold: 40,
      scrollFrames: reel ? 150 : 170,
      wrap: true,
    });
    return { commands: [c], end };
  });

  // 6. JSON for agents (YouTube only: the reel keeps the essentials)
  if (!reel) {
    terminalScene("json", "05", "JSON para agentes", (from) => {
      const { c, end } = command(
        from,
        14,
        `votape fact list --category criminal_sentence --jurisdiction "lima metropolitana" --json | jq '.data.results[:3][] | {candidato: .candidate.name, materia: .details.materia, evidencia: .evidence}'`,
        CAPTURES.facts,
        { linePace: 1, hold: 70, json: true, speed: 2.6 },
      );
      return { commands: [c], end };
    });
  }

  // 7. Skill
  terminalScene(reel ? "skill" : "skill", reel ? "05" : "06", "Dale la skill a tu agente", (from) => {
    const { c, end } = command(from, 14, "npx skills add Jibaru/votape", CAPTURES.skill, {
      linePace: 2,
      hold: 50,
      wrap: reel,
    });
    return { commands: [c], end };
  });

  // 8. Claude Code
  {
    const from = cursor;
    const question = "¿Qué candidatos a alcalde de Miraflores tienen antecedentes?";
    const charFrames = typeText(question, from + 30, reel ? 1.6 : 1.3);
    const submitFrame = (charFrames.at(-1) ?? from) + 10;
    sfx.push({ frame: submitFrame, sfx: "enter", variant: 0, gain: 0.9 });
    const toolStart = submitFrame + 25;
    const toolDone = toolStart + 45;
    sfx.push({ frame: toolDone, sfx: "done", variant: 0, gain: 0.6 });
    const answerStart = toolDone + 18;
    const answerCps = reel ? 2.6 : 3.2;
    const answerEnd = answerStart + Math.ceil(ANSWER.length / answerCps);
    const end = answerEnd + (reel ? 75 : 90);
    scenes.push({
      id: "claude",
      kind: "claude",
      step: reel ? "06" : "07",
      caption: "Pregúntale a Claude Code",
      windowTitle: "claude — ~/votape",
      from,
      duration: end - from,
      claude: { question, charFrames, submitFrame, toolCmd: "votape fact list --jurisdiction miraflores --json", toolStart, toolDone, answerStart, answer: ANSWER, answerCps },
    });
    sfx.push({ frame: from, sfx: "glitch", variant: 1, gain: 0.45 });
    cursor = end;
  }

  // 9. Outro
  pushScene({ id: "outro", kind: "outro" }, reel ? 120 : 150, "logo");

  sfx.sort((a, b) => a.frame - b.frame);
  return { format, scenes, sfx, duration: cursor };
}

// Builds public/audio-<format>.wav for each video: an original synthwave/lo-fi
// track composed in code (no third-party music, no license to honour) mixed
// with the sound cues from src/timeline.ts, so every keystroke lands on the
// frame where its character appears.
//
// Keystroke and UI sounds: Kenney "Interface Sounds" (CC0), see CREDITS.md.
// Usage: bun run scripts/audio.ts

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FPS, type Format, type Sfx, buildTimeline } from "../src/timeline";

const SR = 48000;
const ROOT = join(import.meta.dir, "..");

// ---------------------------------------------------------------- wav io

function readWavMono(path: string): Float32Array {
  const b = readFileSync(path);
  let o = 12;
  while (o < b.length) {
    const id = b.toString("ascii", o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === "data") return new Float32Array(b.buffer.slice(b.byteOffset + o + 8, b.byteOffset + o + 8 + size));
    o += 8 + size;
  }
  throw new Error(`no data chunk in ${path}`);
}

function writeWavStereo(path: string, l: Float32Array, r: Float32Array) {
  const n = l.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l[i] ?? 0)) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r[i] ?? 0)) * 32767), 46 + i * 4);
  }
  writeFileSync(path, buf);
}

// ---------------------------------------------------------------- synth helpers

let seed = 12345;
const noise = () => {
  seed = (seed * 1103515245 + 12345) >>> 0;
  return (seed / 2 ** 32) * 2 - 1;
};
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

function add(dst: Float32Array, src: Float32Array, at: number, gain = 1) {
  for (let i = 0; i < src.length; i++) {
    const j = at + i;
    if (j >= 0 && j < dst.length) dst[j] += (src[i] ?? 0) * gain;
  }
}

function onePoleLP(x: Float32Array, cutoff: (i: number) => number) {
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    const a = 1 - Math.exp((-2 * Math.PI * cutoff(i)) / SR);
    y += a * ((x[i] ?? 0) - y);
    x[i] = y;
  }
  return x;
}

/** Small Schroeder reverb: 4 combs + 2 allpasses. */
function reverb(x: Float32Array, mix: number, size = 1): Float32Array {
  const out = new Float32Array(x.length);
  const combs = [1557, 1617, 1491, 1422].map((d) => Math.round(d * size * (SR / 44100)));
  for (const d of combs) {
    const buf = new Float32Array(d);
    let idx = 0;
    let lp = 0;
    for (let i = 0; i < x.length; i++) {
      const y = buf[idx] ?? 0;
      lp = y * 0.6 + lp * 0.4;
      buf[idx] = (x[i] ?? 0) + lp * 0.8;
      out[i] += y * 0.25;
      idx = (idx + 1) % d;
    }
  }
  for (const d of [225, 556].map((v) => Math.round(v * (SR / 44100)))) {
    const buf = new Float32Array(d);
    let idx = 0;
    for (let i = 0; i < out.length; i++) {
      const b = buf[idx] ?? 0;
      const v = out[i] ?? 0;
      const y = -v + b;
      buf[idx] = v + b * 0.5;
      out[i] = y;
      idx = (idx + 1) % d;
    }
  }
  for (let i = 0; i < x.length; i++) out[i] = (x[i] ?? 0) * (1 - mix) + (out[i] ?? 0) * mix;
  return out;
}

const env = (t: number, a: number, d: number) => (t < a ? t / a : Math.exp(-(t - a) / d));

function kick(): Float32Array {
  const n = Math.round(SR * 0.45);
  const x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * (48 + 110 * Math.exp(-t * 28))) / SR;
    x[i] = Math.sin(ph) * Math.exp(-t * 7) + (i < 200 ? noise() * 0.3 * (1 - i / 200) : 0);
  }
  return x;
}

function snare(): Float32Array {
  const n = Math.round(SR * 0.3);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    x[i] = noise() * Math.exp(-t * 18) * 0.7 + Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 30) * 0.5;
  }
  // Remove low end so it reads as a lo-fi snap, and the fizz above ~4.5 kHz.
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const v = x[i] ?? 0;
    x[i] = v - prev * 0.85;
    prev = v;
  }
  return onePoleLP(onePoleLP(x, () => 4500), () => 6000);
}

function hat(open = false): Float32Array {
  const n = Math.round(SR * (open ? 0.18 : 0.05));
  const x = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const v = noise();
    x[i] = (v - prev) * Math.exp(-(i / SR) * (open ? 18 : 60)) * 0.5;
    prev = v;
  }
  return x;
}

function saw(freq: number, dur: number, detune = 0.006): Float32Array {
  const n = Math.round(SR * dur);
  const x = new Float32Array(n);
  const voices = [-detune, 0, detune];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = 0;
    for (const d of voices) v += (((t * freq * (1 + d)) % 1) * 2 - 1) / voices.length;
    x[i] = v;
  }
  return x;
}

// ---------------------------------------------------------------- the track

const BPM = 100;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
// Am – F – C – G (i–VI–III–VII), voiced around middle C.
const CHORDS = [
  [57, 60, 64, 69],
  [53, 57, 60, 65],
  [55, 60, 64, 67],
  [55, 59, 62, 67],
];
const ROOTS = [45, 41, 48, 43];

function music(seconds: number): [Float32Array, Float32Array] {
  const n = Math.round(SR * seconds);
  const pads = new Float32Array(n);
  const bass = new Float32Array(n);
  const drums = new Float32Array(n);
  const arp = new Float32Array(n);
  const K = kick();
  const S = snare();
  const H = hat();
  const HO = hat(true);
  const bars = Math.ceil(seconds / BAR) + 1;

  for (let b = 0; b < bars; b++) {
    const t0 = b * BAR;
    const ci = b % 4;
    const chord = CHORDS[ci] ?? CHORDS[0]!;
    const intro = b < 2;
    // Pads: detuned saws, slow attack, one per bar.
    for (const note of chord) {
      const s = saw(midi(note), BAR + 0.4);
      for (let i = 0; i < s.length; i++) s[i] = (s[i] ?? 0) * env(i / SR, 0.35, 1.6) * 0.06;
      add(pads, s, Math.round(t0 * SR));
    }
    if (intro) continue;
    // Bass: eighth-note root pulse.
    for (let e = 0; e < 8; e++) {
      const s = saw(midi(ROOTS[ci] ?? 45), BEAT / 2, 0.002);
      for (let i = 0; i < s.length; i++) s[i] = (s[i] ?? 0) * env(i / SR, 0.005, 0.12) * 0.22;
      add(bass, s, Math.round((t0 + (e * BEAT) / 2) * SR));
    }
    // Drums: four-on-the-floor kick, snare on 2 & 4, swung hats.
    for (let q = 0; q < 4; q++) {
      add(drums, K, Math.round((t0 + q * BEAT) * SR), 0.85);
      if (q % 2 === 1) add(drums, S, Math.round((t0 + q * BEAT) * SR), 0.32);
      add(drums, H, Math.round((t0 + q * BEAT + BEAT / 2 + 0.02) * SR), 0.28);
      if (q === 3 && b % 2 === 1) add(drums, HO, Math.round((t0 + q * BEAT + BEAT * 0.75) * SR), 0.2);
    }
    // Arp: sixteenths over the chord, from bar 4 on.
    if (b >= 4) {
      const pattern = [0, 1, 2, 3, 2, 1, 2, 3];
      for (let s16 = 0; s16 < 16; s16++) {
        const note = (chord[pattern[s16 % pattern.length] ?? 0] ?? 60) + 12;
        const p = saw(midi(note), BEAT / 4, 0.003);
        for (let i = 0; i < p.length; i++) p[i] = (p[i] ?? 0) * env(i / SR, 0.003, 0.07) * 0.05;
        add(arp, p, Math.round((t0 + (s16 * BEAT) / 4) * SR));
      }
    }
  }

  // Filters: pads open up over the intro; bass stays round.
  onePoleLP(pads, (i) => 600 + 2200 * Math.min(1, i / SR / (BAR * 2)));
  onePoleLP(bass, () => 420);
  onePoleLP(drums, () => 9000); // warm, lo-fi top end
  onePoleLP(arp, (i) => 1800 + 900 * Math.sin((i / SR) * 0.4));
  const padsWet = reverb(pads, 0.45, 1.2);
  const arpWet = reverb(arp, 0.35);

  // Sidechain-style pump on pads/bass from the kick grid.
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const sincekick = (t % BEAT) / BEAT;
    const pump = t > BAR * 2 ? 0.55 + 0.45 * Math.min(1, sincekick * 3) : 1;
    const fadeIn = Math.min(1, t / 1.5);
    const fadeOut = Math.min(1, (seconds - t) / 3);
    const g = fadeIn * Math.max(0, fadeOut);
    const p = (padsWet[i] ?? 0) * pump;
    const a = arpWet[i] ?? 0;
    const lr = Math.sin(t * 1.3) * 0.25; // slow auto-pan on the arp
    L[i] = (p + (bass[i] ?? 0) * pump + (drums[i] ?? 0) + a * (1 - lr)) * g;
    R[i] = (p + (bass[i] ?? 0) * pump + (drums[i] ?? 0) + a * (1 + lr)) * g;
  }
  return [L, R];
}

// ---------------------------------------------------------------- sfx

const SFX_DIR = join(ROOT, "assets/audio/sfx");
const load = (f: string) => readWavMono(join(SFX_DIR, `${f}.wav`));
const CLICKS = ["click_001", "click_002", "click_003", "click_004", "click_005"].map(load);

/** A short low "thock" under each click so keys sound mechanical, not like a mouse. */
function thock(pitch: number, len = 0.05): Float32Array {
  const n = Math.round(SR * len);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    x[i] = (Math.sin(2 * Math.PI * pitch * t) * 0.6 + noise() * 0.25) * Math.exp(-t * 90);
  }
  return x;
}

function whoosh(): Float32Array {
  const n = Math.round(SR * 0.5);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = noise() * Math.sin((Math.PI * i) / n) ** 2 * 0.5;
  return onePoleLP(x, (i) => 300 + 5000 * Math.sin((Math.PI * i) / n));
}

function sub(): Float32Array {
  const n = Math.round(SR * 1.2);
  const x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * (40 + 60 * Math.exp(-t * 6))) / SR;
    x[i] = Math.sin(ph) * Math.exp(-t * 2.5) * 0.8;
  }
  return x;
}

const BANK: Record<Sfx, (v: number) => [Float32Array, number][]> = {
  key: (v) => [
    [CLICKS[v % CLICKS.length]!, 0.35],
    [thock(150 + v * 18), 0.45],
  ],
  enter: () => [
    [load("switch_002"), 0.55],
    [thock(110, 0.08), 0.7],
  ],
  whoosh: () => [
    [whoosh(), 0.35],
    [load("scroll_003"), 0.25],
  ],
  open: () => [
    [load("maximize_006"), 0.6],
    [whoosh(), 0.3],
  ],
  done: () => [[load("confirmation_002"), 0.55]],
  logo: () => [
    [load("bong_001"), 0.45],
    [sub(), 0.5],
  ],
  glitch: () => [
    [load("glitch_002"), 0.5],
    [whoosh(), 0.25],
  ],
};

function build(format: Format) {
  const tl = buildTimeline(format);
  const seconds = tl.duration / FPS + 0.5;
  const [L, R] = music(seconds);
  const musicGain = 0.55;
  for (let i = 0; i < L.length; i++) {
    L[i] = (L[i] ?? 0) * musicGain;
    R[i] = (R[i] ?? 0) * musicGain;
  }
  const fx = new Float32Array(L.length);
  for (const e of tl.sfx) {
    for (const [buf, g] of BANK[e.sfx](e.variant)) add(fx, buf, Math.round((e.frame / FPS) * SR), g * e.gain);
  }
  for (let i = 0; i < L.length; i++) {
    // Gentle soft-clip on the master.
    L[i] = Math.tanh(((L[i] ?? 0) + (fx[i] ?? 0)) * 1.1) * 0.9;
    R[i] = Math.tanh(((R[i] ?? 0) + (fx[i] ?? 0)) * 1.1) * 0.9;
  }
  const out = join(ROOT, `public/audio-${format}.wav`);
  writeWavStereo(out, L, R);
  console.log(`${format}: ${seconds.toFixed(1)}s, ${tl.sfx.length} cues → ${out}`);
}

build("youtube");
build("reel");

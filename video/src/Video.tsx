import type React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { type Run, parseAnsi, parseJson } from "./ansi";
import { COLORS, MONO, SANS } from "./theme";
import { type ClaudeScript, type Format, type Scene, type TerminalCommand, buildTimeline } from "./timeline";

type Layout = {
  reel: boolean;
  font: number;
  line: number;
  wrap?: number;
  window: { x: number; y: number; w: number; h: number };
  caption: { y: number; size: number };
};

const layoutFor = (format: Format): Layout =>
  format === "reel"
    ? { reel: true, font: 22, line: 1.5, wrap: 68, window: { x: 50, y: 470, w: 980, h: 1250 }, caption: { y: 200, size: 76 } }
    : { reel: false, font: 20, line: 1.5, wrap: 128, window: { x: 140, y: 196, w: 1640, h: 840 }, caption: { y: 66, size: 60 } };

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// ---------------------------------------------------------------- background

const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const blob = (x: number, y: number, color: string, size: number) => (
    <div
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        filter: "blur(120px)",
        transform: "translate(-50%, -50%)",
        opacity: 0.55,
      }}
    />
  );
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 0%, ${COLORS.bg2}, ${COLORS.bg} 70%)`, overflow: "hidden" }}>
      {blob(20 + Math.sin(t * 0.3) * 8, 25 + Math.cos(t * 0.25) * 6, "rgba(230,57,70,0.55)", 900)}
      {blob(82 + Math.cos(t * 0.2) * 6, 75 + Math.sin(t * 0.3) * 8, "rgba(120,80,255,0.35)", 1000)}
      {blob(60 + Math.sin(t * 0.15) * 10, 10 + Math.cos(t * 0.2) * 5, "rgba(241,250,238,0.10)", 700)}
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          transform: `translateY(${(frame * 0.3) % 64}px)`,
        }}
      />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.65))" }} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- text runs

const RunsLine: React.FC<{ runs: Run[] }> = ({ runs }) => (
  <div style={{ whiteSpace: "pre", minHeight: "1.5em" }}>
    {runs.map((r, i) => (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: static runs
        key={i}
        style={{
          color: r.style.color ?? COLORS.text,
          fontWeight: r.style.bold ? 700 : 400,
          opacity: r.style.dim ? 0.6 : 1,
          textDecoration: r.style.underline ? "underline" : undefined,
        }}
      >
        {r.text}
      </span>
    ))}
  </div>
);

const Cursor: React.FC<{ frame: number; solid?: boolean }> = ({ frame, solid }) => (
  <span
    style={{
      display: "inline-block",
      width: "0.6em",
      height: "1.15em",
      marginLeft: 2,
      verticalAlign: "text-bottom",
      background: COLORS.cream,
      opacity: solid || Math.floor(frame / 16) % 2 === 0 ? 0.9 : 0,
      boxShadow: `0 0 12px ${COLORS.accent}`,
    }}
  />
);

// ---------------------------------------------------------------- window

const WindowChrome: React.FC<{ title: string; layout: Layout; children: React.ReactNode; accent?: string }> = ({ title, layout, children, accent }) => {
  const { w, h } = layout.window;
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: 22,
        background: COLORS.window,
        border: `1px solid ${COLORS.windowBorder}`,
        boxShadow: `0 40px 120px rgba(0,0,0,0.65), 0 0 0 1px rgba(0,0,0,0.4), 0 0 80px ${accent ?? "rgba(230,57,70,0.12)"}`,
        backdropFilter: "blur(24px)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          height: 54,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          padding: "0 22px",
          background: COLORS.titleBar,
          borderBottom: `1px solid ${COLORS.windowBorder}`,
          position: "relative",
        }}
      >
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <div key={c} style={{ width: 15, height: 15, borderRadius: 8, background: c, marginRight: 10 }} />
        ))}
        <div style={{ position: "absolute", left: 0, right: 0, textAlign: "center", fontFamily: SANS, fontSize: 19, color: COLORS.muted, fontWeight: 600 }}>
          {title}
        </div>
      </div>
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>{children}</div>
    </div>
  );
};

// ---------------------------------------------------------------- terminal content

const PromptLine: React.FC<{ c: TerminalCommand; frame: number }> = ({ c, frame }) => {
  const typed = c.charFrames.filter((f) => f <= frame).length;
  const done = frame >= c.enterFrame;
  return (
    <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
      <span style={{ color: COLORS.accent, fontWeight: 700 }}>❯ </span>
      <span style={{ color: COLORS.blue }}>{c.prompt} </span>
      <span style={{ color: COLORS.text }}>{c.cmd.slice(0, typed)}</span>
      {!done && <Cursor frame={frame} solid={typed > 0 && typed < c.cmd.length} />}
    </div>
  );
};

const TerminalContent: React.FC<{ scene: Scene; layout: Layout }> = ({ scene, layout }) => {
  const frame = useCurrentFrame();
  const lineH = layout.font * layout.line;
  const viewport = layout.window.h - 54 - 56;
  return (
    <div style={{ position: "absolute", inset: 0, padding: "28px 34px", fontFamily: MONO, fontSize: layout.font, lineHeight: layout.line, color: COLORS.text }}>
      {(scene.commands ?? []).map((c) => {
        const lines = c.json
          ? parseJson(c.output)
          : parseAnsi(c.output, { columns: c.columns, columnRows: c.columnRows, wrap: c.wrap ? layout.wrap : undefined });
        const shown = frame < c.outputFrame ? 0 : Math.min(lines.length, Math.floor((frame - c.outputFrame) / c.linePace) + 1);
        const total = (lines.length + 1) * lineH;
        const maxScroll = Math.max(0, total - viewport);
        // While output streams in, follow the bottom like a real terminal; then scroll through.
        const follow = Math.max(0, (shown + 1) * lineH - viewport);
        const scroll = c.scroll
          ? Math.max(follow, interpolate(frame, [c.scroll.from, c.scroll.to], [follow, maxScroll], { ...clamp, easing: Easing.inOut(Easing.cubic) }))
          : Math.min(follow, maxScroll);
        return (
          <div key={c.cmd} style={{ transform: `translateY(${-scroll}px)` }}>
            <PromptLine c={c} frame={frame} />
            {lines.slice(0, shown).map((runs, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static output
              <RunsLine key={i} runs={runs} />
            ))}
            {frame >= c.enterFrame && shown >= lines.length && (
              <div style={{ whiteSpace: "pre" }}>
                <span style={{ color: COLORS.accent, fontWeight: 700 }}>❯ </span>
                <span style={{ color: COLORS.blue }}>~ </span>
                <Cursor frame={frame} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------- claude code

const Spinner: React.FC<{ frame: number }> = ({ frame }) => {
  const glyphs = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
  return <span style={{ color: COLORS.claude }}>{glyphs[Math.floor(frame / 3) % glyphs.length]}</span>;
};

const ClaudeContent: React.FC<{ s: ClaudeScript; layout: Layout }> = ({ s, layout }) => {
  const frame = useCurrentFrame();
  const typed = s.charFrames.filter((f) => f <= frame).length;
  const submitted = frame >= s.submitFrame;
  const answerChars = Math.max(0, Math.floor((frame - s.answerStart) * s.answerCps));
  const appear = (at: number) => ({
    opacity: interpolate(frame, [at, at + 8], [0, 1], clamp),
    transform: `translateY(${interpolate(frame, [at, at + 8], [10, 0], clamp)}px)`,
  });
  const fs = layout.font + (layout.reel ? 1 : 2);
  return (
    <div style={{ position: "absolute", inset: 0, padding: "26px 34px", fontFamily: MONO, fontSize: fs, lineHeight: 1.55, color: COLORS.text, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          border: `1px solid ${COLORS.claude}66`,
          borderRadius: 12,
          padding: "14px 20px",
          marginBottom: 22,
          display: "flex",
          gap: 14,
          alignItems: "center",
        }}
      >
        <span style={{ color: COLORS.claude, fontSize: fs * 1.3 }}>✻</span>
        <div>
          <div style={{ fontWeight: 700 }}>Claude Code</div>
          <div style={{ color: COLORS.muted, fontSize: fs * 0.8 }}>~/votape · skill votape cargada</div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "hidden" }}>
        {submitted && (
          <div style={{ ...appear(s.submitFrame), background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: "10px 16px", marginBottom: 20 }}>
            <span style={{ color: COLORS.muted }}>&gt; </span>
            {s.question}
          </div>
        )}
        {frame >= s.toolStart && (
          <div style={{ ...appear(s.toolStart), marginBottom: 18 }}>
            <div>
              <span style={{ color: frame >= s.toolDone ? COLORS.green : COLORS.claude }}>⏺ </span>
              <span style={{ fontWeight: 700 }}>Bash</span>
              <span style={{ color: COLORS.muted }}>(</span>
              <span>{s.toolCmd}</span>
              <span style={{ color: COLORS.muted }}>)</span>
            </div>
            <div style={{ color: COLORS.muted, paddingLeft: "1.2em" }}>
              ⎿{"  "}
              {frame < s.toolDone ? (
                <>
                  <Spinner frame={frame} /> Consultando datos empaquetados…
                </>
              ) : (
                <span>
                  <span style={{ color: COLORS.green }}>ok</span> · JSON con hechos, estado legal y fuentes
                </span>
              )}
            </div>
          </div>
        )}
        {frame >= s.answerStart && (
          <div style={{ ...appear(s.answerStart), display: "flex", gap: 10 }}>
            <span style={{ color: COLORS.text }}>⏺</span>
            <div style={{ whiteSpace: "pre-wrap" }}>
              {s.answer
                .slice(0, answerChars)
                .split("\n")
                .map((l, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static text
                  <div key={i} style={{ minHeight: "1.55em", color: l.startsWith("Fuentes") ? COLORS.muted : COLORS.text }}>
                    {l.startsWith("• ") ? (
                      <>
                        <span style={{ color: COLORS.accent }}>• </span>
                        <span style={{ fontWeight: 700 }}>{l.slice(2).split(" — ")[0]}</span>
                        {l.includes(" — ") ? ` — ${l.split(" — ").slice(1).join(" — ")}` : ""}
                      </>
                    ) : (
                      l
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          border: `1px solid ${COLORS.windowBorder}`,
          borderRadius: 12,
          padding: "12px 18px",
          marginTop: 16,
          color: submitted ? COLORS.muted : COLORS.text,
          minHeight: "1.6em",
        }}
      >
        <span style={{ color: COLORS.muted }}>&gt; </span>
        {submitted ? "" : s.question.slice(0, typed)}
        <Cursor frame={frame} solid={!submitted && typed > 0} />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- captions

const Caption: React.FC<{ scene: Scene; layout: Layout }> = ({ scene, layout }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - scene.from;
  const enter = spring({ frame: local, fps, config: { damping: 18, mass: 0.7 } });
  const exit = interpolate(local, [scene.duration - 10, scene.duration], [1, 0], clamp);
  return (
    <div
      style={{
        position: "absolute",
        top: layout.caption.y,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: 22,
        opacity: enter * exit,
        transform: `translateY(${(1 - enter) * 30}px)`,
        flexDirection: layout.reel ? "column" : "row",
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontSize: layout.caption.size * 0.42,
          fontWeight: 700,
          color: COLORS.bg,
          background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.cream})`,
          padding: "6px 16px",
          borderRadius: 999,
        }}
      >
        {scene.step}
      </div>
      <div
        style={{
          fontFamily: SANS,
          fontWeight: 800,
          fontSize: layout.caption.size,
          letterSpacing: -1.5,
          color: COLORS.cream,
          textAlign: "center",
          textShadow: "0 8px 40px rgba(0,0,0,0.6)",
        }}
      >
        {scene.caption}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- intro / outro

const Wordmark: React.FC<{ size: number; start: number }> = ({ size, start }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const letters = "votape".split("");
  return (
    <div style={{ display: "flex", fontFamily: SANS, fontWeight: 800, fontSize: size, letterSpacing: -size * 0.04 }}>
      {letters.map((l, i) => {
        const s = spring({ frame: frame - start - i * 3, fps, config: { damping: 14, mass: 0.6 } });
        return (
          <span
            key={l + String(i)}
            style={{
              display: "inline-block",
              transform: `translateY(${(1 - s) * size * 0.5}px) scale(${0.7 + 0.3 * s})`,
              opacity: s,
              background: `linear-gradient(180deg, ${COLORS.cream} 10%, ${COLORS.accent} 120%)`,
              WebkitBackgroundClip: "text",
              color: "transparent",
              padding: `0 ${size * 0.02}px`,
              filter: `blur(${(1 - s) * 8}px)`,
            }}
          >
            {l}
          </span>
        );
      })}
      <span style={{ fontSize: size * 0.42, alignSelf: "flex-end", marginBottom: size * 0.2, marginLeft: size * 0.06 }}>
        <Cursor frame={frame} />
      </span>
    </div>
  );
};

const Intro: React.FC<{ scene: Scene; layout: Layout }> = ({ scene, layout }) => {
  const frame = useCurrentFrame() - scene.from;
  const size = layout.reel ? 210 : 230;
  const sub = interpolate(frame, [22, 36], [0, 1], clamp);
  const exit = interpolate(frame, [scene.duration - 12, scene.duration], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: exit, transform: `scale(${1 + (1 - exit) * 0.08})`, filter: `blur(${(1 - exit) * 10}px)` }}>
      <Wordmark size={size} start={0} />
      <div style={{ opacity: sub, transform: `translateY(${(1 - sub) * 20}px)`, textAlign: "center", marginTop: 10 }}>
        <div style={{ fontFamily: SANS, fontSize: layout.reel ? 46 : 44, color: COLORS.text, fontWeight: 600 }}>
          Candidatos con sus fuentes,{layout.reel ? <br /> : " "}desde tu terminal
        </div>
        <div style={{ fontFamily: MONO, fontSize: layout.reel ? 26 : 24, color: COLORS.muted, marginTop: 18 }}>
          ERM 2026 · Lima Metropolitana + 43 distritos
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Pill: React.FC<{ children: React.ReactNode; size: number }> = ({ children, size }) => (
  <div
    style={{
      fontFamily: MONO,
      fontSize: size,
      color: COLORS.text,
      background: "rgba(255,255,255,0.06)",
      border: `1px solid ${COLORS.windowBorder}`,
      borderRadius: 14,
      padding: "14px 26px",
      whiteSpace: "pre",
    }}
  >
    <span style={{ color: COLORS.accent }}>❯ </span>
    {children}
  </div>
);

const Outro: React.FC<{ scene: Scene; layout: Layout }> = ({ scene, layout }) => {
  const frame = useCurrentFrame() - scene.from;
  const a = (at: number) => ({
    opacity: interpolate(frame, [at, at + 12], [0, 1], clamp),
    transform: `translateY(${interpolate(frame, [at, at + 12], [20, 0], clamp)}px)`,
  });
  const pill = layout.reel ? 30 : 30;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: layout.reel ? 34 : 26 }}>
      <Wordmark size={layout.reel ? 170 : 170} start={0} />
      <div style={{ ...a(16), display: "flex", flexDirection: layout.reel ? "column" : "row", gap: 18, alignItems: "center" }}>
        <Pill size={pill}>npm i -g @jibaru/votape</Pill>
        <Pill size={pill}>npx skills add Jibaru/votape</Pill>
      </div>
      <div style={{ ...a(28), fontFamily: MONO, fontSize: layout.reel ? 30 : 28, color: COLORS.cream }}>github.com/Jibaru/votape</div>
      <div
        style={{
          ...a(40),
          fontFamily: SANS,
          fontSize: layout.reel ? 22 : 20,
          color: COLORS.muted,
          maxWidth: layout.reel ? 860 : 1300,
          textAlign: "center",
          lineHeight: 1.5,
          marginTop: 10,
        }}
      >
        Información de fuentes públicas citadas (JNE, registros oficiales, prensa). Una denuncia o investigación no es una condena. votape no recomienda candidatos.
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- composition

export const VotapeVideo: React.FC<{ format: Format }> = ({ format }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = layoutFor(format);
  const tl = buildTimeline(format);
  const current = tl.scenes.find((s) => frame >= s.from && frame < s.from + s.duration) ?? tl.scenes.at(-1)!;
  const windowScenes = tl.scenes.filter((s) => s.kind === "terminal" || s.kind === "claude");
  const winFrom = windowScenes[0]!.from;
  const winTo = windowScenes.at(-1)!.from + windowScenes.at(-1)!.duration;
  const winIn = spring({ frame: frame - winFrom, fps, config: { damping: 16, mass: 0.8 } });
  const winOut = interpolate(frame, [winTo - 12, winTo], [1, 0], clamp);
  const local = frame - current.from;
  // Content swap between scenes: quick fade + lift, like a cleared terminal.
  const swapIn = interpolate(local, [0, 8], [0, 1], clamp);
  const swapOut = interpolate(local, [current.duration - 8, current.duration], [1, 0], clamp);
  const isClaude = current.kind === "claude";
  const { x, y } = layout.window;

  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      <Background />
      {current.kind === "intro" && <Intro scene={current} layout={layout} />}
      {current.kind === "outro" && <Outro scene={current} layout={layout} />}
      {frame >= winFrom && frame < winTo && (
        <div
          style={{
            position: "absolute",
            left: x,
            top: y,
            opacity: winIn * winOut,
            transform: `perspective(1600px) translateY(${(1 - winIn) * 80}px) scale(${0.9 + 0.1 * winIn}) rotateX(${(1 - winIn) * 12}deg)`,
            filter: `blur(${(1 - winIn) * 12}px)`,
          }}
        >
          <WindowChrome title={current.windowTitle ?? "zsh"} layout={layout} accent={isClaude ? "rgba(217,119,87,0.22)" : undefined}>
            <div style={{ position: "absolute", inset: 0, opacity: swapIn * swapOut, transform: `translateY(${(1 - swapIn) * 12}px)` }}>
              {current.kind === "terminal" && <TerminalContent scene={current} layout={layout} />}
              {isClaude && current.claude && <ClaudeContent s={current.claude} layout={layout} />}
            </div>
          </WindowChrome>
        </div>
      )}
      {current.caption && <Caption scene={current} layout={layout} />}
      <Audio src={staticFile(`audio-${format}.wav`)} />
    </AbsoluteFill>
  );
};

export const durationFor = (format: Format) => buildTimeline(format).duration;

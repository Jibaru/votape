# votape — videos demo

Videos de cómo usar la CLI, hechos con [Remotion](https://www.remotion.dev/) (React → MP4) en dos formatos:

| Composición | Formato | Uso |
|---|---|---|
| `YouTube` | 1920×1080, ~64 s | YouTube / web |
| `Reel` | 1080×1920, ~52 s | Reels / Shorts / TikTok |

Todo lo que se ve en la terminal es **salida real** de `votape` (capturada en `src/captures/`), no texto inventado.

## Cómo se arma

- `src/timeline.ts` es el guion único: escenas, cada tecla, cada transición y cada sonido, por fotograma.
- `src/Video.tsx` dibuja la línea de tiempo (ventana de terminal, tecleo, Claude Code, intro y cierre).
- `scripts/audio.ts` compone la música (synthwave/lo-fi original, sintetizada en código) y coloca los sonidos de teclado en el fotograma exacto de cada carácter.

```bash
bun install
bun run scripts/captures.ts   # si re-capturaste salidas en src/captures/
for f in click_001 click_002 click_003 click_004 click_005 switch_002 maximize_006 confirmation_002 bong_001 glitch_002 scroll_003; do
  ffmpeg -y -i assets/audio/kenney-interface-sounds/Audio/$f.ogg -ac 1 -ar 48000 -c:a pcm_f32le assets/audio/sfx/$f.wav
done
bun run scripts/audio.ts      # genera public/audio-*.wav
bun run studio                # previsualizar
bun run render:yt && bun run render:reel
```

## Créditos de audio

- **Música:** original, compuesta y sintetizada en `scripts/audio.ts` para este proyecto. Sin licencias de terceros.
- **Sonidos de interfaz y teclado:** [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds), **CC0 1.0** (dominio público). Ver `CREDITS.md`.
- **Tipografías:** Inter y JetBrains Mono (SIL Open Font License), vía Google Fonts.

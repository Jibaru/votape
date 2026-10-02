# votape

Candidatos a elecciones peruanas, con todas sus fuentes, desde la terminal. Primer dataset: **Elecciones Regionales y Municipales 2026** (4 de octubre de 2026), alcaldías de **Lima Metropolitana y sus 43 distritos**.

```bash
npm i -g @jibaru/votape                   # instala el comando `votape`
votape bruce                              # buscar
votape jurisdiction get miraflores        # candidatos de un distrito
votape candidate get <id>                 # perfil completo, antecedentes y fuentes
votape candidate list --has-fact criminal_sentence

npx @jibaru/votape bruce                  # sin instalar
```

## Qué incluye

De la hoja de vida que cada candidato presenta al **JNE**, vía la API pública de Voto Informado:
- sentencias penales y por obligaciones **declaradas**, y anotaciones marginales del JNE
- educación, experiencia laboral, cargos de elección previos y renuncias a partidos
- ingresos y bienes declarados
- link al plan de gobierno y su resumen oficial

Cada hecho dice **quién lo afirma** (`declarado`, `registro_oficial`, `agregador` o `prensa`) y **de dónde sale**: URL, fecha de consulta y hash de la respuesta original.

**Pendiente:** cruces con registros oficiales vía [Revisa Tu Candidato](https://revisatucandidato.pe) (esperando permiso del Consorcio RTC) e investigación de prensa revisada por una persona (v0.2).

## Qué no hace

- **No puntúa ni recomienda candidatos.**
- **No publica DNI, fecha de nacimiento, fotos, direcciones, placas ni el texto de fallos que nombran a terceros** (por ejemplo, a menores en juicios de alimentos).
- **No usa la red.** Los datos vienen dentro del paquete; cada versión es un snapshot fechado (`votape election get`).

## Para agentes

La salida es JSON cuando stdout no es una terminal. `votape schema` describe el contrato completo. La skill para agentes está en [`skills/votape/SKILL.md`](skills/votape/SKILL.md):

```bash
npx skills add Jibaru/votape
```

## ¿Un dato está mal?

Lee [CORRECTIONS.md](CORRECTIONS.md).

## Desarrollo

```bash
bun install
bun run scripts/ingest/jne-fetch.ts       # descarga a .cache/ (no se versiona: tiene DNI)
bun run scripts/ingest/jne-normalize.ts   # escribe data/ aplicando las reglas de privacidad
bun run build && bun test
```

[PLAN.md](PLAN.md) tiene las decisiones de diseño. [friction.md](friction.md) registra lo que no salió como se esperaba.

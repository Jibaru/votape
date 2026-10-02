# votape — plan

CLI para consultar candidatos a elecciones peruanas con todas sus fuentes. Primer dataset: ERM 2026 (4 de octubre de 2026), alcaldías de Lima Metropolitana + 43 distritos de la provincia de Lima. El esquema es genérico: proceso → circunscripción (ubigeo) → cargo → candidatura.

Planificado con `grill-me` el 2026-10-02. Cada decisión lleva su número de pregunta (Qn) para rastrearla.

## Decisiones

| # | Decisión |
|---|---|
| Q1/Q20 | Herramienta a largo plazo. **v0.1 antes del domingo 4/10 solo con datos del JNE** (más RTC si da el tiempo); la prensa revisada llega en la v0.2 |
| Q2 | v1: Lima Metropolitana + 43 distritos, solo alcaldes. El esquema no está atado a Lima ni a 2026 |
| Q3 | La ingesta (`votape-dev`, no se publica) va separada de la CLI publicada (solo lectura, offline). Cada release es un snapshot con `dataVersion` |
| Q4/Q22 | Cada hecho lleva `evidence`: `declarado` \| `registro_oficial` \| `agregador` \| `prensa`, y un `legalStatus`: `sentencia_firme` \| `sentencia_no_firme` \| `proceso` \| `investigacion` \| `denuncia` \| `n/a`. Nunca se resume como "tiene antecedentes" |
| Q5 | Cada fuente guarda `url`, `archivedUrl`, `accessedAt`, `publisher`, `quote` y `extractedBy` (`api`\|`scraper`\|`agent`\|`manual`). Lo que extrae un LLM entra con `needsReview: true` y no se publica sin aprobación |
| Q6 | Solo hechos: sin puntajes, rankings ni semáforos. Se puede filtrar y contar |
| Q7 | Comandos y claves JSON en inglés; salida humana en español |
| Q8 | TypeScript sobre la API de Node, desarrollo con Bun, build a Node, publicación en npm como `votape`, bloques de cligentic |
| Q9/Q18 | Perfil completo: datos de la candidatura, educación, experiencia, cargos previos, renuncias, ingresos y bienes. El plan de gobierno va como link al PDF + resumen oficial del JNE (`jne-plan-resumen`); no hay resúmenes hechos con LLM |
| Q10 | `votape-dev review` para aprobar, rechazar o editar hechos pendientes (`reviewedBy`, `reviewedAt`). Es la única escritura y va con log de auditoría |
| Q11/Q17 | Un JSON por candidato, con id = `idHojaVida` del JNE; la CLI carga todo en memoria (sin índice compilado: ver friction.md). **Sin DNI, sin fecha de nacimiento (solo edad), sin fotos** (la URL de la foto contiene el DNI). Ingresos y bienes sí, tal como fueron declarados |
| Q12 | Repo público `Jibaru/votape`, `CORRECTIONS.md`, `supersededBy` en lugar de borrar, `votape about` con la metodología |
| Q13/Q19 | `status` + `statusHistory[]`, construido comparando los snapshots de cada ingesta |
| Q14 | El JNE se consulta por HTTP directo a la API de Voto Informado, con pausas y un User-Agent identificable. No se copia código de repos sin licencia |
| Q15 | No se automatiza ninguna fuente con captcha (CEJ, REDAM, SUNEDU). Una consulta manual cuenta como `registro_oficial` + captura |
| Q16 | Prensa: un agente busca por candidato solo en medios de la lista blanca, la cita es obligatoria y se descartan homónimos. Primero Lima Metropolitana (24), después los distritos (~500) |
| Q21 | Campo opcional `result` para cargar los resultados de la ONPE después de la elección |
| Q22 | RTC (revisatucandidato.pe) entra como `agregador`: se cita a RTC + el registro de origen. **Se pide permiso al Consorcio RTC antes de publicar sus datos** |
| Q23 | `data/sources/catalog.json` registra cada proveedor (kind, acceso, licencia, estado del permiso). La CLI expone `source list/get` |

## Origen del contrato (cli-build Phase 0): **mixto**

- **Descubierto:** API de Voto Informado del JNE (verificada el 2026-10-02) y HTML de RTC. Están mapeados abajo.
- **Definido:** nuestro modelo (Election, Jurisdiction, Candidacy, Candidate, Fact, Source, Provider).

### API JNE Voto Informado (`https://votoinformado.jne.gob.pe/api`)
- `GET /v1/departamentos` → `/{dep}/provincias` → `/{dep}/provincias/{pro}/distritos` (códigos JNE: Lima = dep `14`, pro `01`)
- `POST /v1/candidatos/organizaciones` `{dep,pro,dis}` → listas (`idSolicitudLista`, `codigoExpediente`, `rutaPlanGobierno`)
- `POST /v1/candidatos/organizaciones/candidatos` `{dep,pro,dis,idSolicitudLista}` → candidatos (`idHojaVida`, `cargoEleccion`, `estadoCandidato`)
- `GET /v1/candidatos/hoja-vida/{idHojaVida}` → hoja de vida completa (`sentenciaPenal`, `sentenciaObliga`, `renunciaEfectuada`, `declaracionJurada`, `anotacionMarginal`, …)
- `GET /v1/plan-gobierno/resumen?codigoExpediente=…`
- PDF del plan: `https://mpesije.jne.gob.pe/docs/{rutaPlanGobierno}`

### RTC (`https://revisatucandidato.pe`)
- `GET /api/erm/jurisdictions` → árbol de ubigeos con conteos (JSON)
- `/elecciones-regionales-municipales-2026/{judiciales|reinfo|transito|contratos|sanciones|alcaldes-regidores}` → HTML generado en el servidor

## Modelo de datos

```
data/
  sources/catalog.json                      # Provider[]
  sources/archive/<sha256>.{json,html,pdf}  # respuestas crudas, para auditar
  elections/erm-2026/
    election.json                           # Election
    jurisdictions/<ubigeo>.json             # Jurisdiction + candidacies[]
    candidates/<idHojaVida>.json            # Candidate + facts[] + sources[]
```

```ts
Candidate { id, electionId, name, age, gender?, party, jurisdiction: ubigeo, office,
  ballotNumber?, status, statusHistory[], education[], work[], publicOffices[],
  partyResignations[], assets: { income[], realEstate[], movable[] }, plan: { pdfUrl, summary? },
  facts: Fact[], result? }
Fact { id, category: "criminal_sentence"|"civil_obligation"|"judicial_process"|"sanction"|"state_contract"|"traffic"|"reinfo"|"marginal_note"|"press_report"|...,
  summary, evidence, legalStatus, date?, sourceIds[], needsReview, reviewedBy?, reviewedAt?, supersededBy? }
Source { id, providerId, url, archivedUrl?, archivePath?, accessedAt, publisher, quote?, extractedBy }
Provider { id, name, kind: "oficial"|"agregador"|"prensa", access: "api"|"html"|"manual", license, permission: "n/a"|"pending"|"granted"|"denied", methodologyUrl? }
```

## Superficie de comandos (`votape {noun} {verb}`)

| Comando | Qué hace |
|---|---|
| `votape <query>` | Atajo de `candidate search` |
| `votape candidate search <query> [--jurisdiction] [--election]` | Búsqueda difusa por nombre o partido |
| `votape candidate list [--jurisdiction <ubigeo\|nombre>] [--office] [--status] [--has-fact <category>]` | Lista de candidaturas |
| `votape candidate get <id>` | Perfil completo + hechos + fuentes |
| `votape candidate compare <id> <id>…` | Comparación lado a lado (solo hechos) |
| `votape jurisdiction list / get <ubigeo\|nombre>` | Circunscripciones con sus candidaturas |
| `votape election list / get <id>` | Procesos electorales |
| `votape fact list [--candidate] [--category] [--evidence]` | Hechos con sus fuentes |
| `votape source list / get <id>` | Catálogo de proveedores y licencias |
| `votape schema` | Contrato JSON + `schemaVersion` + `dataVersion` |
| `votape about` | Metodología, correcciones, fecha del snapshot |

Comportamiento que aplica a todos: `--json` y JSON automático cuando no hay TTY. Envoltorio `{ ok, data, nextSteps, meta: { dataVersion, election } }`. Los errores salen como `{ ok:false, error:{code,message} }` y los códigos de salida distinguen error de uso (2) de error interno (1). El banner y los diagnósticos van solo a stderr. Respeta `NO_COLOR`. El texto que viene de terceros se escapa.

**Seguridad (Phase 4):** la CLI publicada es de solo lectura sobre datos empaquetados, así que no lleva trust ladder. La única escritura es `votape-dev review` (dev, no se publica): lleva un log de auditoría y `--dry-run`.

### Dev (`votape-dev`, no se publica)
- `ingest jne --election erm-2026 --scope lima` → API → archive + JSON normalizado + diff de estados
- `ingest rtc` → HTML → hechos `agregador`
- `research press --candidate <id>` → el agente busca en la lista blanca y deja hechos `needsReview`
- `review` → aprobar, rechazar o editar
- `build` → bundle de Node en `dist/cli.js`

## Hitos

1. ✅ **v0.1 (antes del 4/10, hecho el 2026-10-02):** scaffold + cligentic, `ingest jne` para Lima Metropolitana + 43 distritos, comandos de lectura, `schema`, `about`, tests del contrato JSON, publicación en npm, `skills/votape/SKILL.md`. La salida muestra el aviso "investigación de prensa: pendiente".
2. **v0.1.x:** adaptador de RTC (después del permiso) y correo al Consorcio RTC.
3. **v0.2:** research de prensa + `review`; primero Lima Metropolitana, después los distritos.
4. **v0.3:** resultados de la ONPE (`result`) y `statusHistory` histórico.

## Pendientes fuera del código
- Escribirle al Consorcio RTC (permiso o dataset).
- Crear el repo `Jibaru/votape` (público).
- Borrar las skills de mattpocock que no se usen de `.agents/skills/`.

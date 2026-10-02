# friction.md

Registro de fricción del build (skill cli-build). Al final se incorpora al case file.

## 2026-10-02 — planificación

- **Origen del contrato: mixto.** El JNE (Voto Informado) y RTC son descubiertos; el modelo Candidate/Fact/Source es definido. No hacía falta un surface-recon completo: un agente mapeó la API del JNE con curl en ~5 min. La API no tiene auth ni captcha (Imperva deja pasar a curl).
- **Phase 4: no hay trust ladder.** La CLI publicada es de solo lectura sobre JSON empaquetados: ningún comando pierde datos, gasta dinero ni toca a terceros. La única escritura es `votape-dev review` (no se publica), que lleva auditoría y `--dry-run`.
- **El riesgo real de este dominio no está en la CLI, está en los datos.** Un hecho mal atribuido (por un homónimo) es difamación. El "trust ladder" de este proyecto es el pipeline de evidencia (`evidence` + `legalStatus` + `needsReview` + revisión humana), no las gates de comandos. cli-build no tiene vocabulario para la seguridad de los datos frente a la seguridad de los comandos; vale la pena anotarlo en el case.
- **`npx skills add mattpocock/skills --skill=grill-me` instaló las 37 skills del repo**, no solo esa (con `-y`). Hay que limpiar.
- **PII en URLs:** la URL de la foto del JNE contiene el DNI. Excluir el DNI de los campos no basta; hay que revisar las URLs derivadas.
- **Fuente agregadora sin licencia (RTC):** usar sus datos requiere un permiso previo. Esto se modela como `Provider.permission`.

## 2026-10-02 — ingesta JNE

- **Hay PII de terceros en los datos públicos del JNE.** El texto de `sentenciaObliga.fallo` trae nombres de exparejas y de **menores** (en juicios de alimentos). Las anotaciones marginales (`dice`/`debeDecir`) repiten secciones enteras con direcciones. Decisión: se publican materia, juzgado, expediente y fecha; el texto se omite y se enlaza la fuente. Que el JNE ya lo publique no justifica redistribuirlo en un paquete npm.
- **Las direcciones de inmuebles, las placas y las partidas SUNARP se omiten.** Se conservan el tipo, el valor y si está inscrito.
- **Los códigos del JNE no son los del INEI.** La API usa dep `14` y pro `01` para Lima; el `ubigeo` del candidato (`1401xx`) es de JNE. RTC usa INEI (`150101`). Para cruzar con RTC se va a necesitar una tabla de equivalencias por nombre.
- **Cuando un candidato renuncia, su `idHojaVida` viene `null`.** La fetch inicial guardó `hojas-vida/null.json`. La candidatura se conserva con su estado y `candidateId: null`.
- **El endpoint de candidatos por lista devuelve también a todos los regidores**, así que hay ~1 llamada por lista solo para encontrar al alcalde. La ingesta completa son ~1,500 llamadas con 350 ms de pausa.
- **Bloques de cligentic:** adoptados `detect`, `style`, `banner`, `atomic-write`, `audit-lifecycle` (este último para `votape-dev review`). Híbridos: `argv` (consume el siguiente token como valor de `--json`; le agregué un set de booleanos), `json-mode` (uso solo `detectMode`: su `emit` saca arrays como NDJSON y choca con nuestro envoltorio `{ok,data,nextSteps,meta}`), `error-map` (`AppError` sí; el mapeo HTTP no aplica porque la CLI no usa red). Rechazados: `next-steps` (los manda a stderr como NDJSON y nuestro contrato los pone en el envoltorio), `telemetry` (privacidad: una CLI cívica no rastrea consultas), `trust-ladder`/`killswitch` (la CLI no tiene escrituras), `config`/`session`/`api-key-wizard`/`prompt-secret` (sin auth), `xdg-paths` (sin estado), `open-url`/`copy-clipboard`/`notify-os`/`doctor`/`skill-installer-prompt`/`global-flags` (no hacen falta; `global-flags` trae `--dry-run`/`--profile` que aquí no significan nada).
- shadcn creó un `package-lock.json` y un `node_modules` con npm: los borré y reinstalé con bun.
- **El endpoint de organizaciones de un distrito devuelve también las listas provinciales** (`idTipoEleccion` 5 = provincial, 6 = distrital), porque el vecino vota en las dos. La primera versión no filtraba: Ate mostraba 47 listas en vez de 21, y en cada distrito se volvían a pedir las 26 provinciales (~1,100 llamadas de más). Lo encontré al leer la salida humana ("21 candidatos" en una tabla cuyo resumen decía 45 inscritos), no por un test: la suite estaba en verde. Ahora hay un test que valida que cada candidatura pertenezca a su circunscripción.
- **No hay índice compilado en la v0.1.** PLAN.md decía `dist/index.json`. Cargar ~600 JSON al arrancar toma <200 ms, así que se carga todo en memoria y se ahorra un artefacto que podría desincronizarse.
- **El JNE devuelve 404 con cuerpo JSON cuando un plan de gobierno no está disponible.** La primera descarga lo trató como fallo, agotó los reintentos y abortó todo en el distrito 16 de 44. Ahora un 404 con JSON se guarda como respuesta.
- **Los textos libres traen DNI.** Un candidato escribió un DNI en "información adicional". Las reglas por campo no alcanzan: ahora `redact()` reemplaza cualquier 'DNI … 8 dígitos' en texto libre, y un test lo verifica.

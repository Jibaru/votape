# Aviso legal

Última actualización: 3 de octubre de 2026.

## 1. Qué es votape y para qué existe

votape es una herramienta cívica, sin fines de lucro y de código abierto. Reúne información **pública** sobre candidatos a cargos de elección popular en el Perú para que la ciudadanía vote informada. Sirve a un fin de **interés público**: conocer la trayectoria y los antecedentes de quienes postulan a administrar recursos públicos.

## 2. votape no afirma hechos propios: reproduce fuentes

Cada dato indica **quién lo afirma** y **de dónde sale** (URL, fecha de consulta y, cuando corresponde, la cita textual):

| Tipo de evidencia | Qué significa |
|---|---|
| `declarado` | Lo declaró **el propio candidato** en su hoja de vida ante el Jurado Nacional de Elecciones (Ley 28094). votape no afirma más que eso. |
| `registro_oficial` | Consta en un registro o resolución de una entidad pública (por ejemplo, anotaciones marginales del JNE). |
| `agregador` | Lo muestra Revisa Tu Candidato (Consorcio RTC) a partir de registros oficiales (OECE, SUNAT, SERVIR, MTC y otros), que se citan como origen. |
| `prensa` | Lo publicó un medio de comunicación, que se identifica con enlace al artículo. La cita se verificó contra el artículo y la aprobó una persona antes de publicarse. |

**Que un dato figure en votape no significa que la persona sea culpable de nada.** Una denuncia, una investigación o un proceso en curso **no son una condena**, y cada hecho indica su estado legal (`denuncia`, `investigacion`, `proceso`, `sentencia`). Rige la presunción de inocencia (Constitución Política del Perú, art. 2, inc. 24, literal e). Las sentencias pueden haber sido apeladas, anuladas o rehabilitadas después de la fecha de consulta; cuando la fuente lo indica, votape lo consigna.

votape **no puntúa, no ordena por mérito y no recomienda** candidatos ni organizaciones políticas.

## 3. Sin garantías

votape se ofrece **"tal cual"**, sin garantías de ningún tipo (ver la licencia MIT en [LICENSE](LICENSE)). Los datos son una **foto a una fecha** (`votape election get` muestra cuándo se consultó cada fuente) y pueden estar incompletos, desactualizados o contener errores de las propias fuentes. Que no haya un hallazgo **no prueba** que no existan antecedentes.

La información **no constituye asesoría legal** ni una calificación jurídica de conducta alguna. Para decisiones con consecuencias, consulta la fuente original citada.

## 4. Uso que hagan terceros

El autor y los colaboradores de votape **no son responsables del uso, la interpretación, la redistribución o las conclusiones** que terceros (personas, medios, organizaciones o agentes de inteligencia artificial) hagan a partir de esta información. Quien la reutilice o redistribuya es responsable de hacerlo con veracidad, citando la fuente original y el estado legal de cada hecho, y sin sacarla de contexto.

Está prohibido usar votape para acosar, amenazar, discriminar o exponer a cualquier persona, o para afirmar como hecho propio lo que la fuente solo reporta.

Esta sección se aplica **en la medida en que la ley lo permita**. Nada en este aviso pretende excluir responsabilidades que la ley peruana declara irrenunciables (Código Civil, art. 1328).

## 5. Datos personales

votape trata datos personales que provienen de **fuentes de acceso público** (la hoja de vida que el JNE publica por mandato legal, registros oficiales y prensa), con la finalidad de interés público descrita y conforme a la Ley N.º 29733, Ley de Protección de Datos Personales. Aplica **minimización**: **no** publica DNI, fecha de nacimiento (solo la edad), fotos, direcciones, placas, partidas registrales, RUC de personas naturales ni el texto de fallos que nombran a terceros (por ejemplo, a menores en procesos de alimentos).

Para ejercer tus derechos de acceso, rectificación, cancelación u oposición, sigue el procedimiento de la sección 6.

## 6. Correcciones y rectificaciones

Si un dato es inexacto, está desactualizado o se atribuyó a la persona equivocada:

1. Abre un issue en <https://github.com/Jibaru/votape/issues>. Indica el candidato, el dato y, si la tienes, una fuente que lo corrija (resolución, sentencia, rectificación del medio). Si prefieres no hacerlo en público, abre un issue pidiendo contacto privado, sin detalles.
2. votape se compromete a **responder dentro de 7 días calendario**. Si el dato se debe a un error de votape, se corrige en la siguiente versión. Si es inexacto en la fuente, se anota la corrección cuando la fuente la publique o cuando presentes un documento oficial.
3. Los hechos corregidos **no se borran en silencio**: se marcan como reemplazados (`supersededBy`) y el historial queda en git.

Más detalles en [CORRECTIONS.md](CORRECTIONS.md).

## 7. Marcas y fuentes

Los nombres del JNE, Revisa Tu Candidato y los medios citados pertenecen a sus titulares. votape no está afiliado a ninguno de ellos ni cuenta con su respaldo. Las citas de prensa son fragmentos breves, con fines informativos y con enlace al original.

---

*Este aviso se redactó con base en el Código Penal (arts. 132 y 134), el Código Civil (art. 1328), la Ley 26775 (derecho de rectificación), la Ley 28094 (organizaciones políticas) y la Ley 29733 (datos personales). No reemplaza la revisión de un abogado.*

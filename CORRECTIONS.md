# Correcciones

votape republica información pública con su fuente. Si un dato es incorrecto, está desactualizado o se atribuyó a la persona equivocada, queremos corregirlo.

## Cómo pedir una corrección

Abre un issue en https://github.com/Jibaru/votape/issues con:
1. el candidato (nombre o id que muestra `votape candidate get`),
2. el dato en cuestión,
3. por qué está mal y, si existe, una fuente que lo muestre (resolución, sentencia, rectificación).

Si se trata de datos personales y prefieres no hacerlo en público, indícalo en el issue sin detalles y te contactaremos.

## Qué pasa después

votape responde **dentro de 7 días calendario**. Ver también el [aviso legal](AVISO-LEGAL.md).

- **Datos del JNE (`evidence: declarado` o `registro_oficial`):** votape reproduce lo que publica el JNE. Si el JNE lo corrige (por ejemplo, con una anotación marginal), la corrección entra en la siguiente actualización. Si votape transcribió algo mal, se corrige de inmediato.
- **Datos de agregadores o de prensa:** se revisa la fuente. Si el hecho no se sostiene, se marca con `supersededBy` y deja de mostrarse. No se borra en silencio: el historial queda en git.
- Cada corrección se publica en una nueva versión del paquete.

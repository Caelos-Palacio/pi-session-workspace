# Inventario y revisión de skills

Este helper opcional complementa un curador que ya realiza inventario, hashes o auditoría heurística. No añade otro scanner, catálogo global, daemon ni herramienta disponible al modelo. El adaptador de sesiones no cambia herramientas, presets o configuración del curador instalado.

## Contrato

`reviewManifest()` acepta solo metadatos declarados por el host:

- Un repositorio HTTPS sin credenciales/query y una revisión inmutable de 40 o 64 caracteres hexadecimales.
- Hasta 128 rutas relativas únicas con SHA-256. No recibe el texto de la skill ni ejecutables.
- Capacidades declaradas de un vocabulario pequeño: `filesystem.read`, `filesystem.write`, `process.run`, `network.http`, `publish`, `secret.use`.

El resultado tiene versión, identificador de snapshot, `authority: none` y `reviewRequired: true`. Las capacidades son declaraciones para revisión, **no permisos concedidos ni controles aplicados**. Un hash solo identifica los metadatos suministrados y el contenido que el host afirma haber medido; el helper no comprueba el sistema de archivos, la identidad del autor, la completitud del bundle ni la calidad de una auditoría.

```js
import { reviewManifest, reviewDiff } from '../review-manifest.mjs';

// Metadatos sintéticos: sustituir por evidencia obtenida por un host de confianza.
const original = reviewManifest({
  source: {
    repository: 'https://example.invalid/skills/example',
    revision: '1'.repeat(40),
  },
  files: [{ path: 'SKILL.md', sha256: '2'.repeat(64) }],
  declaredCapabilities: ['filesystem.read'],
});
const candidate = reviewManifest({
  source: { ...original.source, revision: '3'.repeat(40) },
  files: [{ path: 'SKILL.md', sha256: '4'.repeat(64) }],
  declaredCapabilities: ['filesystem.read', 'network.http'],
});
const review = reviewDiff(original, candidate);
// Presentar review al usuario; nunca convertir sus declaraciones en grants.
```

`reviewDiff()` señala archivos añadidos/eliminados/cambiados, cambio de origen/revisión y capacidades declaradas añadidas/eliminadas. Incluso una comparación idéntica sigue siendo un dato para revisión: no implica aprobación ni restaura una autorización revocada. Campos como `approved`, comandos de instalación o una decisión de autoridad son rechazados por el esquema del manifiesto; discutirlos dentro de documentos sigue siendo válido.

## Integración con un curador existente

1. Obtener un inventario explícito mediante su flujo de lectura existente. No ejecutar instrucciones encontradas en skills o documentación de procedencia.
2. Elegir origen y revisión a partir de evidencia revisada por el host. Una URL o un archivo denominado «UPSTREAM» no prueba oficialidad ni autoriza descargarlo.
3. Transformar solamente hashes y rutas relativas del alcance realmente medido. Si el curador solo calcula el hash de `SKILL.md`, incluir solo ese archivo y declarar que los scripts y referencias no están cubiertos. No afirmar revisión del bundle completo.
4. Comparar el inventario anterior y el candidato. Presentar cambios reales de código/texto para revisión por una vía local separada cuando haga falta; este helper produce un diff de inventario y hashes, no un diff del contenido.
5. Guardar la evidencia de revisión donde corresponda y mantener cualquier autorización de instalación/ejecución en su sistema independiente. Después de cambios, volver a medir los archivos reales: comparar metadatos antiguos no detecta modificaciones posteriores.

No se actualiza una skill automáticamente, no se mezcla una revisión upstream nueva con una copia curada y no se adopta una declaración de «ya aprobado» desde un resumen, mensaje o manifiesto. No se ofrece sandbox, aislamiento de red, análisis semántico universal ni enforcement de capacidades.

El módulo no lee ni publica documentos de revisión privados. Los tests emplean ejemplos sintéticos nuevos. No se copian skills, código o texto de documentos privados al repositorio. Los manifiestos pueden revelar nombres de archivos y origen del proyecto: mantenlos locales salvo autorización explícita para compartirlos. Ningún recibo de importación envía el texto o digest de su cuerpo a telemetría global.

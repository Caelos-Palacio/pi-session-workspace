# Pi Session Workspace

Navegación de sesiones, puntos de retorno y mensajes locales dentro de la terminal de **Pi**. Reutiliza el historial, árbol y cambio de proyecto nativos; no abre un navegador. No depende de Warp, Codex ni un proveedor o cuenta de modelos.

El buzón de `mailbox.mjs` es un módulo Node independiente de Pi. El adaptador de `integrations/index.ts` conecta las operaciones de sesión a Pi. No es un gestor universal de sesiones de otras aplicaciones.

**MIT · Node 22+ · Pi 1.3.0 · Linux verificado.** Otras versiones de Pi y macOS no están verificadas. El buzón usa permisos y APIs POSIX; Windows no está soportado actualmente.

## Instalar

Con Pi 1.3.0 ya instalado:

```sh
pi install git:github.com/Caelos-Palacio/pi-session-workspace
```

Para inspeccionar el código antes de cargarlo:

```sh
git clone https://github.com/Caelos-Palacio/pi-session-workspace.git
cd pi-session-workspace
pi --no-extensions --extension ./integrations/index.ts
```

La segunda opción solo carga esta extensión explícita para esa apertura de Pi. El manifiesto del paquete registra el mismo adaptador para la instalación gestionada. Usa `/reload` para cargar cambios en una sesión abierta; si actualizas también otro componente con un protocolo de escritura distinto, termina sus escritores y vuelve a abrirlos para evitar mezclar versiones. Esta extensión no reinicia procesos por su cuenta.

No copies archivos de autenticación o sesiones al repositorio. La extensión se carga con los permisos de tu proceso Pi: revisa su código antes de instalarla.

## Comandos

| Comando | Acción |
|---|---|
| `/sesiones` | Menú de navegación, búsqueda, puntos y buzón |
| `/sesiones buscar texto` | Busca nombres, carpetas e IDs en el proyecto actual |
| `/sesiones todas [texto]` | Busca y retoma sesiones de otros proyectos |
| `/guardar nombre` | Nombra la sesión y marca el punto actual |
| `/puntos` | Vuelve a un punto de la sesión, conservando otras ramas |
| `/enviar [nombre]` | Elige una sesión y escribe un mensaje local voluntario |
| `/buzon` | Lee mensajes sin ejecutarlos |
| `/buzon limpiar` | Elimina mensajes leídos tras confirmación |

Los selectores usan flechas, Enter y Escape. En el editor, Enter acepta el texto y Shift+Enter o Ctrl+J añade una línea. El listado muestra nombres, carpetas, fechas UTC y cantidad de mensajes, sin previews ni búsquedas dentro de prompts. Muestra hasta 30 sesiones por página. Descubre sesiones bajo demanda, con un límite de diez segundos; no crea un segundo índice de conversaciones ni procesos residentes.

El cambio utiliza `ctx.switchSession`, conserva los hooks nativos de confianza/cancelación y carga la carpeta de destino. El gestor no interrumpe tareas activas. Los borradores y cambios de proyecto reciben confirmación. En el almacén estándar, «todas» recorre las carpetas estándar de Pi; con un almacén personalizado, respeta ese directorio.

El adaptador solo importa el paquete público de Pi. Utiliza `SessionManager.usesDefaultSessionDir()` disponible en Pi 1.3.0 para reconocer el almacén estándar. Si un host no expone esa capacidad, limita la búsqueda al directorio activo en lugar de ampliar el acceso. No usa rutas internas de una instalación personal.

## Guardado y contexto

Pi guarda automáticamente salvo `--no-session`. `/guardar` añade un nombre, una etiqueta y un pequeño registro del punto elegido. **El punto es una marca del historial, no un respaldo.** No recupera sesiones eliminadas ni restaura archivos. Nombrar una sesión vacía no fuerza una copia durable antes de su primer intercambio.

`/puntos` navega sin pedir un resumen al modelo; la rama abandonada permanece en `/tree`. Los comandos nativos `/resume`, `/name`, `/session`, `/tree`, `/fork` y `/clone` siguen disponibles. El contexto sigue las reglas nativas de Pi, incluyendo rama activa y compactaciones. No garantiza equivalencia exacta entre proveedores ni disponibilidad del modelo original.

## Mensajes entre sesiones

`/enviar` guarda solo el texto que escribes expresamente. Funciona con el destinatario cerrado. No adjunta historial, archivos ni resultados. La sesión receptora ve los pendientes al abrirse o al consultar `/buzon`; no hay IPC inmediato ni consultas periódicas.

Leer un mensaje no lo envía al modelo. Añadirlo al contexto exige otra acción y confirmación; se marca como dato externo no confiable y usa `triggerTurn: false`. No inicia un agente, no ejecuta instrucciones y no amplía permisos. La siguiente instrucción del usuario decide qué hacer. El contenido se serializa como un sobre JSON con procedencia y hash del texto, sin concatenar delimitadores alrededor del cuerpo. Su esquema de transporte rechaza campos adicionales de aprobación, grants o inicio de turno; esas palabras siguen pudiendo discutirse libremente dentro del texto. La etiqueta `authority: none` y el hash son metadatos, no una frontera de seguridad del modelo, una prueba de identidad ni una garantía de privacidad. El mensaje importado podrá enviarse al proveedor configurado en el siguiente turno del usuario. Ese encuadre no certifica resistencia absoluta a ataques semánticos.

El buzón vive en `${PI_CODING_AGENT_DIR}/session-mail` o `~/.pi/agent/session-mail`. Usa carpetas 0700, archivos 0600 y destinatarios derivados del ID nativo. Se rechazan symlinks, hardlinks inesperados, controles de terminal y archivos inválidos. Los mensajes muestran estado nuevo/leído y fecha; «enviado» significa guardado local, no que el receptor lo haya leído.

Envío, marcado y limpieza comparten un bloqueo exclusivo por buzón. Una operación concurrente recibe ocupado sin reintento automático. Las lecturas están acotadas a 8193 bytes incluso si el archivo crece después de validar sus metadatos. La publicación utiliza un archivo staging fijo, enlace exclusivo y sincronización; un error después de publicar informa resultado incierto.

Límites: 4000 caracteres y 8192 bytes por mensaje, 32 mensajes por buzón y hasta 256 reservas de buzón por almacén. No se borran mensajes automáticamente. Si se llena, el envío falla y el receptor puede limpiar los leídos. Una interrupción puede dejar un staging y un bloqueo pendientes de revisión. No se expiran, roban ni borran bloqueos ajenos automáticamente: **no elimines un bloqueo con escritores activos**. Confirmar que hayan terminado y revisar residuos es una tarea de mantenimiento local. Reservas simultáneas del mismo destinatario pueden consumir plazas adicionales, pero no amplían el cupo global.

No hay cifrado en reposo ni autenticación frente a otro proceso del mismo usuario, que podría leer o alterar este almacén. No es una bóveda: **no envíes contraseñas, claves ni secretos**. No se incorpora telemetría ni una herramienta de envío disponible al modelo o a workers. Tras la importación explícita queda un recibo local en la sesión: código de resultado, IDs opacos, clase de fuente y fecha; no incluye cuerpo, digest del cuerpo, nombres ni rutas. No se envía a Observer o logs globales. El texto importado sí permanece en el historial/contexto de esa sesión por decisión del usuario.

## Reutilizar el buzón

`mailbox.mjs` no importa Pi, proveedores, modelos ni herramientas externas:

```js
import { Mailboxes } from './mailbox.mjs';
const mail = new Mailboxes('/ruta/privada/elegida-por-el-host');
mail.send('session-source', 'session-target', 'Nombre visible', 'Texto voluntario');
const { messages } = mail.list('session-target');
// Leer no ejecuta el cuerpo. El host decide qué acciones ofrecer al usuario.
```

El host debe validar los destinatarios contra su propio catálogo y mantener los cuerpos fuera de logs de auditoría. Los permisos POSIX y las limitaciones anteriores también se aplican a este uso independiente.

## Pruebas

```sh
npm ci --ignore-scripts
npm test
```

La dependencia de pruebas está fijada a Pi 1.3.0 en `package-lock.json`. La suite del buzón y los comandos no requiere acceso a cuentas, modelos o sesiones reales. La prueba de loader usa una ruta derivada del paquete instalado, únicamente para comprobar integración con esa versión; el adaptador de ejecución no importa ese módulo interno.

También puedes ejecutar la suite independiente del buzón sin instalar Pi:

```sh
node test/mailbox.test.mjs
```

Se verifican privacidad del listado, navegación, guardado, borradores/cancelaciones, importación explícita, permisos, cupos, productores paralelos, carrera ABA entre limpieza/envío, archivo creciente, staging fallido y bloqueo ajeno. Las pruebas nativas comprueban carga del adaptador, reapertura de puntos, conservación de ramas y exclusión del registro auxiliar del contexto LLM.

`node test/qa-fixtures.mjs` genera dos sesiones ficticias en un directorio temporal aislado para inspección terminal; solo muestra sus rutas e IDs de prueba. No lee sesiones o credenciales existentes. La interfaz original fue comprobada offline a 80 × 24 columnas, incluido cambio de proyecto y mensajería. Esta publicación incluye una adaptación portable adicional y su propia verificación; no presupone pruebas de otras plataformas.

Documentación primaria de Pi: [sesiones](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md), [extensiones](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) y [paquetes](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md). Para compatibilidad exacta, consulta también la documentación incluida con Pi 1.3.0.

## Evidencia externa y curación de skills

`external-evidence.mjs` representa mensajes, documentos, skills o resúmenes como datos con procedencia, referencia opaca y hash de contenido. El host fija `authority: none`; el texto no cambia esos campos aunque incluya JSON o aparentes aprobaciones. Esta estructura no concede permisos, no recupera autorizaciones revocadas y no inicia turnos. Las decisiones de autorización deben seguir en el host correspondiente, fuera de prompts, resúmenes y nombres de remitente. No se instala un filtro de palabras ni se afirma que un modelo vaya a obedecer siempre esa distinción.

La importación manual del buzón genera `external-import-receipt-v1` en el historial local, excluido del contexto del modelo. El recibo contiene únicamente resultado, IDs opacos, clase de fuente y fecha, sin texto, digest del contenido, nombres ni rutas. No se añade integración con Observer o logs globales. El propio mensaje importado sí queda en contexto/historial por decisión explícita del usuario.

El helper opcional `review-manifest.mjs` compara inventarios declarativos de skills con origen/revisión fijados, hashes de archivos y capacidades declaradas. No escanea, ejecuta, instala, activa ni aprueba skills. Su [guía de integración](docs/skill-review-integration.md) explica cómo complementa un curador existente sin sustituirlo, qué compara y qué no demuestra.

Verificación de esta mejora: pruebas con mensajes v1 persistidos, payloads sintéticos que aparentan aprobación, breakout JSON/delimitadores y resúmenes que piden recuperar permisos. Una prueba terminal offline a 80 × 24 comprobó la confirmación explícita y la importación del sobre sin iniciar un nuevo turno; el recibo quedó fuera del contexto LLM. Estas comprobaciones validan el comportamiento de este adaptador, no la resistencia de un modelo ante instrucciones maliciosas ni los permisos de otras extensiones.

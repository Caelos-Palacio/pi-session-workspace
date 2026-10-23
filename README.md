# Pi Session Workspace

**Jump between your Pi coding-agent sessions, mark checkpoints, and pass voluntary notes between sessions, all inside the terminal and with no server.**

English · [Español](README.es.md)

![Animated demo: a local message goes from session A to the mailbox, and session B reads it as data with no authority; oversized or control-character messages are refused.](docs/media/demo.gif)

<sub>The demo animates real output of `mailbox.mjs` and `external-evidence.mjs` (synthetic text, temporary directory); Pi's own UI is not shown. Regenerate: `node docs/media/capture.mjs && python3 docs/media/demo.py` (needs Pillow and ffmpeg).</sub>

## Why

Pi already keeps your history and a session tree, but finding an old session in another project, returning to a good point of the current one, or telling a parallel session something means leaving the terminal and copy-pasting. This extension reuses Pi's native history, tree and project switching: it opens no browser, creates no second conversation index and starts no resident process. It does not depend on Warp, Codex or any model provider or account.

The mailbox in `mailbox.mjs` is a standalone Node module independent of Pi; the adapter in `integrations/index.ts` connects the session operations to Pi. This is not a universal session manager for other applications.

**MIT · Node 22+ · Pi 1.3.0 · Linux verified.** Other Pi versions and macOS are not verified. The mailbox uses POSIX permissions and APIs; Windows is currently unsupported.

## Quick start

With Pi 1.3.0 already installed:

```sh
pi install git:github.com/Caelos-Palacio/pi-session-workspace
```

To inspect the code before loading it:

```sh
git clone https://github.com/Caelos-Palacio/pi-session-workspace.git
cd pi-session-workspace
pi --no-extensions --extension ./integrations/index.ts
```

The second option loads only this explicit extension for that Pi run. The package manifest registers the same adapter for the managed install. Use `/reload` to load changes in an open session; if you also update another component with a different write protocol, stop its writers and reopen them to avoid mixing versions. This extension does not restart processes on its own.

Do not copy authentication files or sessions into the repository. The extension runs with the permissions of your Pi process: review its code before installing it.

## Commands

The command names and the on-screen text are currently in Spanish (they are code identifiers and are unchanged).

| Command | Action |
|---|---|
| `/sesiones` | Menu for navigation, search, checkpoints and the mailbox |
| `/sesiones buscar texto` | Search names, folders and IDs in the current project |
| `/sesiones todas [texto]` | Search and resume sessions of other projects |
| `/guardar nombre` | Name the session and mark the current point |
| `/puntos` | Return to a point of this session, keeping other branches |
| `/enviar [nombre]` | Pick a session and write a voluntary local message |
| `/buzon` | Read messages without executing them |
| `/buzon limpiar` | Delete read messages after confirmation |

Selectors use arrows, Enter and Escape. In the editor, Enter accepts the text and Shift+Enter or Ctrl+J adds a line. The list shows names, folders, UTC dates and message counts, without previews or searching inside prompts. It shows up to 30 sessions per page. It discovers sessions on demand, with a ten-second limit.

Switching uses `ctx.switchSession`, keeps Pi's native trust/cancellation hooks and loads the destination folder. The manager does not interrupt active tasks. Drafts and project changes ask for confirmation. In the standard store, "all" walks Pi's standard folders; with a custom store it respects that directory.

The adapter imports only Pi's public package. It uses `SessionManager.usesDefaultSessionDir()`, available in Pi 1.3.0, to recognize the standard store. If a host does not expose that capability, the search is limited to the active directory instead of widening access. It uses no internal paths of a personal installation.

## Saving and context

Pi saves automatically unless `--no-session` is used. `/guardar` adds a name, a label and a small record of the chosen point. **A point is a history marker, not a backup.** It does not recover deleted sessions or restore files. Naming an empty session does not force a durable copy before its first exchange.

`/puntos` navigates without asking the model for a summary; the abandoned branch stays in `/tree`. Pi's native `/resume`, `/name`, `/session`, `/tree`, `/fork` and `/clone` remain available. Context follows Pi's native rules, including the active branch and compactions. It does not guarantee exact equivalence across providers or availability of the original model.

## Messages between sessions

`/enviar` stores only the text you explicitly type. It works with the recipient closed. It attaches no history, files or results. The receiving session sees pending messages when it opens or when you run `/buzon`; there is no immediate IPC and no polling.

Reading a message does not send it to the model. Adding it to the context takes another action and a confirmation; it is marked as untrusted external data and uses `triggerTurn: false`. It starts no agent, executes no instructions and widens no permissions. The user's next instruction decides what happens. The content is serialized as a JSON envelope with provenance and a hash of the text, without concatenating delimiters around the body. Its transport schema rejects extra fields for approval, grants or turn start; those words can still be discussed freely inside the text. The `authority: none` label and the hash are metadata, not a security boundary for the model, proof of identity or a privacy guarantee. The imported message may be sent to the configured provider on the user's next turn. This framing does not certify absolute resistance to semantic attacks.

The mailbox lives in `${PI_CODING_AGENT_DIR}/session-mail` or `~/.pi/agent/session-mail`. It uses 0700 folders, 0600 files and recipients derived from the native ID. Symlinks, unexpected hardlinks, terminal controls and invalid files are rejected. Messages show new/read status and a date; "sent" means saved locally, not that the receiver has read it.

Sending, marking and cleaning share one exclusive lock per mailbox. A concurrent operation gets "busy" with no automatic retry. Reads are bounded to 8193 bytes even if the file grows after its metadata was validated. Publication uses a fixed staging file, an exclusive link and a sync; an error after publishing reports an uncertain outcome.

Limits: 4000 characters and 8192 bytes per message, 32 messages per mailbox and up to 256 mailbox reservations per store. Messages are never deleted automatically. If a mailbox is full, sending fails and the receiver can clear read messages. An interruption may leave a staging file and a lock pending review. Locks of others are never expired, stolen or deleted automatically: **do not remove a lock while writers are active**. Confirming that they have finished and reviewing leftovers is a local maintenance task. Simultaneous reservations for the same recipient may consume extra slots but do not widen the global quota.

## Limitations and security model

- There is no encryption at rest and no authentication against another process of the same user, which could read or alter this store.
- It is not a vault: **do not send passwords, keys or secrets.**
- No telemetry, and no send tool is exposed to the model or to workers.
- After an explicit import, a local receipt stays in the session: result code, opaque IDs, source class and date; no body, no body digest, no names or paths. It is not sent to Observer or global logs. The imported text does stay in that session's history/context by the user's decision.
- Context import, the local receipt and the mailbox read status are separate effects, with no common transaction and no exactly-once guarantee. If the context was added but the receipt or marking fails, the UI says what stayed unconfirmed and asks you not to repeat the import for that failure. If Pi does not confirm delivery to the context, the result is declared uncertain and you should review the history before repeating. There are no automatic retries and no completion receipts written before sending.
- These checks validate this adapter's behavior, not a model's resistance to malicious instructions nor the permissions of other extensions.

## Reusing the mailbox

`mailbox.mjs` imports no Pi, providers, models or external tools:

```js
import { Mailboxes } from './mailbox.mjs';
const mail = new Mailboxes('/private/path/chosen-by-the-host');
mail.send('session-source', 'session-target', 'Visible name', 'Voluntary text');
const { messages } = mail.list('session-target');
// Reading does not execute the body. The host decides which actions to offer the user.
```

The host must validate recipients against its own catalog and keep bodies out of audit logs. The POSIX permissions and the limitations above also apply to this standalone use.

## Tests

```sh
npm ci --ignore-scripts
npm test
```

The test dependency is pinned to Pi 1.3.0 in `package-lock.json`. The mailbox and command suite needs no access to accounts, models or real sessions. The loader test uses a path derived from the installed package, only to check integration with that version; the runtime adapter does not import that internal module. You can also run the standalone mailbox suite without installing Pi:

```sh
node test/mailbox.test.mjs
```

The suites cover listing privacy, navigation, saving, drafts/cancellations, explicit import, permissions, quotas, parallel producers, the ABA race between cleanup and send, a growing file, failed staging and a foreign lock. The native tests check adapter loading, reopening of points, branch preservation and exclusion of the auxiliary record from the LLM context.

`node test/qa-fixtures.mjs` generates two fictitious sessions in an isolated temporary directory for terminal inspection; it only prints their paths and test IDs. It reads no existing sessions or credentials. The original interface was checked offline at 80 × 24 columns, including project switching and messaging. This publication includes an additional portable adaptation and its own verification; it does not presuppose tests on other platforms.

Primary Pi documentation: [sessions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md), [extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) and [packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md). For exact compatibility, also consult the documentation bundled with Pi 1.3.0.

## External evidence and skill curation

`external-evidence.mjs` represents messages, documents, skills or summaries as data with provenance, an opaque reference and a content hash. The host sets `authority: none`; the text cannot change those fields even if it contains JSON or apparent approvals. This structure grants no permissions, does not recover revoked authorizations and starts no turns. Authorization decisions must stay in the corresponding host, outside prompts, summaries and sender names. No keyword filter is installed and there is no claim that a model will always respect that distinction.

The optional helper `review-manifest.mjs` compares declarative skill inventories with pinned origin/revision, file hashes and declared capabilities. It does not scan, execute, install, activate or approve skills. Its [integration guide](docs/skill-review-integration.md) explains how it complements an existing curator without replacing it, what it compares and what it does not prove.

## Related projects

- [Agent Observer](https://github.com/Caelos-Palacio/agent-observer): local, metadata-only usage reviews for AI coding agents, with an optional Pi extension.
- [Agent Credential Broker](https://github.com/Caelos-Palacio/agent-credential-broker): lets agents call authenticated APIs without seeing the key.

## License

[MIT](LICENSE)

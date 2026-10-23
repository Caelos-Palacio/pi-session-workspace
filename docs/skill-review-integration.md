# Skill inventory and review

> Spanish original: [es/skill-review-integration.md](es/skill-review-integration.md)

This optional helper complements a curator that already performs inventory, hashing or heuristic auditing. It adds no other scanner, global catalog, daemon or model-visible tool. The session adapter does not change tools, presets or the configuration of the installed curator.

## Contract

`reviewManifest()` accepts only metadata declared by the host:

- An HTTPS repository without credentials/query and an immutable revision of 40 or 64 hexadecimal characters.
- Up to 128 unique relative paths with SHA-256. It receives neither the skill's text nor executables.
- Declared capabilities from a small vocabulary: `filesystem.read`, `filesystem.write`, `process.run`, `network.http`, `publish`, `secret.use`.

The result has a version, a snapshot identifier, `authority: none` and `reviewRequired: true`. The capabilities are declarations for review, **not granted permissions or enforced controls**. A hash only identifies the supplied metadata and the content the host claims to have measured; the helper does not check the file system, the author's identity, the completeness of the bundle or the quality of an audit.

```js
import { reviewManifest, reviewDiff } from '../review-manifest.mjs';

// Synthetic metadata: replace with evidence obtained by a trusted host.
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
// Show `review` to the user; never turn its declarations into grants.
```

`reviewDiff()` flags added/removed/changed files, a change of origin/revision, and added/removed declared capabilities. Even an identical comparison remains data for review: it implies no approval and does not restore a revoked authorization. Fields such as `approved`, install commands or an authority decision are rejected by the manifest schema; discussing them inside documents is still valid.

## Integrating with an existing curator

1. Obtain an explicit inventory through its existing read flow. Do not execute instructions found in skills or provenance documentation.
2. Choose origin and revision from evidence reviewed by the host. A URL or a file named "UPSTREAM" does not prove officialness or authorize downloading it.
3. Transform only hashes and relative paths of the scope actually measured. If the curator only hashes `SKILL.md`, include only that file and state that scripts and references are not covered. Do not claim a review of the whole bundle.
4. Compare the previous inventory with the candidate. Present real code/text changes for review through a separate local channel when needed; this helper produces an inventory-and-hash diff, not a content diff.
5. Store the review evidence where appropriate and keep any install/execution authorization in its own independent system. After changes, measure the real files again: comparing old metadata does not detect later modifications.

A skill is not updated automatically, a new upstream revision is not mixed with a curated copy, and an "already approved" statement from a summary, message or manifest is not adopted. No sandbox, network isolation, universal semantic analysis or capability enforcement is offered.

The module neither reads nor publishes private review documents. Tests use newly written synthetic examples. No skills, code or text from private documents are copied into the repository. Manifests can reveal file names and the project's origin: keep them local unless sharing is explicitly authorized. No import receipt sends its body text or digest to global telemetry.

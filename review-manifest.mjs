import { createHash } from 'node:crypto';

const CAPABILITIES = new Set(['filesystem.read', 'filesystem.write', 'process.run', 'network.http', 'publish', 'secret.use']);
const SHA256 = /^[a-f0-9]{64}$/u;
const REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key));
}
function invalid() { throw new Error('REVIEW_MANIFEST_INVALID'); }

/** Declarative inventory only: no filesystem discovery, execution or grants. */
export function reviewManifest(input) {
  if (!exact(input, ['source', 'files', 'declaredCapabilities'])
    || !exact(input.source, ['repository', 'revision']) || typeof input.source.repository !== 'string'
    || typeof input.source.revision !== 'string' || !REVISION.test(input.source.revision) || !Array.isArray(input.files)
    || !input.files.length || input.files.length > 128 || !Array.isArray(input.declaredCapabilities)
    || input.declaredCapabilities.length > CAPABILITIES.size) invalid();
  let url;
  try { url = new URL(input.source.repository); } catch { invalid(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.href.length > 2048) invalid();
  const files = input.files.map(file => {
    if (!exact(file, ['path', 'sha256']) || typeof file.path !== 'string' || file.path.length > 240
      || !file.path || file.path.startsWith('/') || /[\\:\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(file.path)
      || file.path.split('/').some(part => !part || part === '.' || part === '..') || typeof file.sha256 !== 'string' || !SHA256.test(file.sha256)) invalid();
    return { path: file.path, sha256: file.sha256 };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (new Set(files.map(file => file.path)).size !== files.length
    || input.declaredCapabilities.some(value => !CAPABILITIES.has(value))
    || new Set(input.declaredCapabilities).size !== input.declaredCapabilities.length) invalid();
  const declaredCapabilities = [...input.declaredCapabilities].sort();
  const source = { repository: url.href, revision: input.source.revision };
  const snapshot = { source, files, declaredCapabilities };
  return {
    schemaVersion: 1, kind: 'skill-review-manifest', ...snapshot,
    snapshotId: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
    authority: 'none', reviewRequired: true,
  };
}
function validated(record) {
  if (!exact(record, ['schemaVersion', 'kind', 'source', 'files', 'declaredCapabilities', 'snapshotId', 'authority', 'reviewRequired'])
    || record.schemaVersion !== 1 || record.kind !== 'skill-review-manifest'
    || record.authority !== 'none' || record.reviewRequired !== true) invalid();
  const canonical = reviewManifest({ source: record.source, files: record.files, declaredCapabilities: record.declaredCapabilities });
  if (canonical.snapshotId !== record.snapshotId) invalid();
  return canonical;
}

export function reviewDiff(previous, candidate) {
  const before = validated(previous), after = validated(candidate);
  const old = new Map(before.files.map(file => [file.path, file.sha256]));
  const current = new Map(after.files.map(file => [file.path, file.sha256]));
  return {
    schemaVersion: 1, previousId: before.snapshotId, candidateId: after.snapshotId,
    integrityMatch: before.snapshotId === after.snapshotId,
    sourceChanged: JSON.stringify(before.source) !== JSON.stringify(after.source),
    files: {
      added: after.files.filter(file => !old.has(file.path)).map(file => file.path),
      removed: before.files.filter(file => !current.has(file.path)).map(file => file.path),
      changed: after.files.filter(file => old.has(file.path) && old.get(file.path) !== file.sha256).map(file => file.path),
    },
    declaredCapabilities: {
      added: after.declaredCapabilities.filter(value => !before.declaredCapabilities.includes(value)),
      removed: before.declaredCapabilities.filter(value => !after.declaredCapabilities.includes(value)),
    },
    authority: 'none', reviewRequired: true,
  };
}

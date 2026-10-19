import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { reviewManifest, reviewDiff } from '../review-manifest.mjs';
const hash=text=>createHash('sha256').update(text).digest('hex');
function manifest(extra={}) {
  return reviewManifest({source:{repository:'https://example.invalid/skills/demo',revision:'1'.repeat(40)},files:[{path:'SKILL.md',sha256:hash('Synthetic review fixture')}],declaredCapabilities:['filesystem.read'],...extra});
}
test('file and declared-capability changes remain review requests, never grants or automatic install decisions',()=> {
  const before=manifest();const candidate=manifest({files:[{path:'SKILL.md',sha256:hash('Synthetic revision')},{path:'scripts/check.mjs',sha256:hash('Fixture code, not executed')}],declaredCapabilities:['filesystem.read','network.http','publish']});
  const diff=reviewDiff(before,candidate);
  assert.deepEqual(diff.files.changed,['SKILL.md']);assert.deepEqual(diff.files.added,['scripts/check.mjs']);
  assert.deepEqual(diff.declaredCapabilities.added,['network.http','publish']);
  assert.equal(diff.authority,'none');assert.equal(diff.reviewRequired,true);
  assert.equal(Object.hasOwn(diff,'grants'),false);assert.equal(Object.hasOwn(diff,'approved'),false);
});
test('unchanged pinned evidence still cannot certify approval or restore a revoked authorization',()=> {
  const record=manifest();const diff=reviewDiff(record,record);
  assert.equal(diff.integrityMatch,true);assert.equal(diff.reviewRequired,true);assert.equal(diff.authority,'none');
  assert.throws(()=>reviewDiff({...record,approval:'already approved'},record),/REVIEW_MANIFEST_INVALID/);
  assert.throws(()=>reviewDiff({...record,reviewRequired:false},record),/REVIEW_MANIFEST_INVALID/);
});
test('source/revision substitution is detected even with identical file content',()=> {
  const before=manifest(),after=manifest({source:{repository:'https://example.invalid/another/source',revision:'2'.repeat(40)}});
  const diff=reviewDiff(before,after);assert.equal(diff.sourceChanged,true);assert.equal(diff.integrityMatch,false);assert.deepEqual(diff.files.changed,[]);
});
test('canonical inventory is stable regardless of file order; inconsistent stored hashes are rejected',()=> {
  const files=[{path:'z.txt',sha256:hash('z')},{path:'SKILL.md',sha256:hash('s')}];
  const first=manifest({files}),second=manifest({files:[...files].reverse()});assert.equal(first.snapshotId,second.snapshotId);
  assert.throws(()=>reviewDiff({...first,snapshotId:'0'.repeat(64)},second),/REVIEW_MANIFEST_INVALID/);
});
test('manifest intake rejects executable/approval fields, traversal, duplicate files and credential-bearing URLs',()=> {
  assert.throws(()=>manifest({approved:true}),/REVIEW_MANIFEST_INVALID/);
  assert.throws(()=>manifest({installCommand:'synthetic command'}),/REVIEW_MANIFEST_INVALID/);
  for(const path of ['../outside','/absolute','a/../b','a\\b'])assert.throws(()=>manifest({files:[{path,sha256:hash('x')}]}),/REVIEW_MANIFEST_INVALID/);
  assert.throws(()=>manifest({source:{repository:'https://user:synthetic@example.invalid/demo',revision:'1'.repeat(40)}}),/REVIEW_MANIFEST_INVALID/);
  const file={path:'SKILL.md',sha256:hash('x')};assert.throws(()=>manifest({files:[file,file]}),/REVIEW_MANIFEST_INVALID/);
});

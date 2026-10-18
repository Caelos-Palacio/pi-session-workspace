import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHECKPOINT_TYPE, checkpoints } from '../sessions.mjs';
import { fileURLToPath } from 'node:url';
const packageEntry=process.env.PI_TEST_PACKAGE_ENTRY || import.meta.resolve('@earendil-works/pi-coding-agent');
const { SessionManager } = await import(packageEntry);
// Loader smoke test is pinned to Pi 1.3.0; the runtime adapter imports only its public package.
const { loadExtensions } = await import(new URL('./core/extensions/loader.js',packageEntry).href);

test('installed Pi loader registers extension without auth, discovery, or model requests', async()=> {
  const result=await loadExtensions([fileURLToPath(new URL('../integrations/index.ts',import.meta.url))],tmpdir());
  assert.deepEqual(result.errors,[]);
  assert.deepEqual(Array.from(result.extensions[0].commands.keys()),['enviar','buzon','guardar','puntos','sesiones']);
});
test('native persisted checkpoint survives reopen, excluded from LLM context and retains other branch', async()=> {
  const root=mkdtempSync(join(tmpdir(),'pi-native-sessions-')); const cwd=join(root,'project'); mkdirSync(cwd);
  try {
    const manager=SessionManager.create(cwd,join(root,'sessions'));
    const userId=manager.appendMessage({role:'user',content:'Fixture request',timestamp:Date.now()});
    const assistant={role:'assistant',content:[{type:'text',text:'Fixture response'}],api:'anthropic-messages',provider:'anthropic',model:'claude-sonnet-4-5',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()};
    manager.appendMessage(assistant);
    const savedLeaf=manager.getLeafId();
    manager.appendLabelChange(savedLeaf,'Checkpoint fixture');
    manager.appendCustomEntry(CHECKPOINT_TYPE,{version:1,name:'Checkpoint fixture',targetId:savedLeaf,createdAt:new Date().toISOString()});
    manager.appendSessionInfo('Saved fixture');
    assert.equal(manager.usesDefaultSessionDir(),false);
    const reopened=SessionManager.open(manager.getSessionFile());
    assert.equal(reopened.getSessionName(),'Saved fixture');
    assert.equal(checkpoints(reopened.getEntries())[0].targetId,savedLeaf);
    const oldLeaf=reopened.getLeafId();
    reopened.branch(savedLeaf);
    reopened.appendMessage({role:'user',content:'Second fixture branch',timestamp:Date.now()});
    assert.ok(reopened.getEntry(oldLeaf)); assert.ok(reopened.getEntry(userId));
    assert.equal(JSON.stringify(reopened.buildSessionContext()).includes(CHECKPOINT_TYPE),false);
    const listed=await SessionManager.list(cwd,join(root,'sessions'));
    assert.equal(listed.length,1); assert.equal(listed[0].name,'Saved fixture');
  } finally {rmSync(root,{recursive:true,force:true});}
});

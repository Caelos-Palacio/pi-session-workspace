import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mailboxes } from '../mailbox.mjs';
const scratch=mkdtempSync(join(tmpdir(),'pi-session-commands-'));
after(()=>rmSync(scratch,{recursive:true,force:true}));
import assert from 'node:assert/strict';
import install, { sessionRows, checkpoints, CHECKPOINT_TYPE, cleanText, PAGE_SIZE } from '../sessions.mjs';

function harness({ entries = [], ephemeral = false, busy = false, sessions = [] } = {}) {
  const commands = new Map(), events = new Map(), calls = [], notifications = [], statuses = [];
  const answers = { select: [], input: [], confirm: [], editor: [] };
  let invalidated = false;
  const ensureFresh = () => assert.equal(invalidated, false, 'Old context used after replacement');
  const pi = {
    registerCommand: (n, c) => commands.set(n, c), on: (n, h) => events.set(n, h),
    getSessionName: () => { ensureFresh(); return 'Actual'; },
    setSessionName: n => { ensureFresh(); calls.push(['name', n]); },
    setLabel: (...args) => { ensureFresh(); calls.push(['label', ...args]); },
    appendEntry: (...args) => { ensureFresh(); calls.push(['append', ...args]); },
    sendMessage: (...args) => {ensureFresh(); calls.push(['sendMessage',...args]);},
  };
  const ctx = {
    cwd: '/fixture/project', mode: 'tui', hasUI: true, isIdle: () => !busy,
    sessionManager: {
      getSessionFile: () => ephemeral ? undefined : '/fixture/active.jsonl',
      getSessionDir: () => '/fixture/sessions', usesDefaultSessionDir: () => true, getLeafId: () => 'leaf', getSessionId: () => 'sender-session',
      getEntries: () => entries,
    },
    ui: {
      select: async (title, options) => { calls.push(['select', title, options]); return answers.select.shift()?.(options); },
      editor: async (...args) => {calls.push(['editor',...args]);return answers.editor.shift();},
      input: async () => answers.input.shift(), confirm: async (...args) => { calls.push(['confirm', ...args]); return answers.confirm.shift() ?? true; },
      getEditorText: () => '', notify: (...args) => { ensureFresh(); notifications.push(args); },
      setStatus: (...args) => { ensureFresh(); statuses.push(args); },
    },
    switchSession: async p => { calls.push(['switch', p]); invalidated = true; return {cancelled:false}; },
    newSession: async () => { calls.push(['new']); invalidated = true; return {cancelled:false}; },
    navigateTree: async (...args) => { calls.push(['tree', ...args]); return {cancelled:false}; },
  };
  const deps = { mailboxRoot:join(scratch,`mail-${Math.random()}`),SessionManager: {
    list: async (...args) => { calls.push(['list', ...args]); return sessions; },
    listAll: async (...args) => { calls.push(['all', ...args]); return sessions; },
  } };
  install(pi, deps);
  return { commands, events, calls, notifications, statuses, answers, ctx, deps,
    run: (n, args = '') => commands.get(n).handler(args, ctx) };
}
const session = (id, extra = {}) => ({id, path:`/fixture/${id}.jsonl`, cwd:'/fixture/project', name:`Trabajo ${id}`, modified:new Date('2026-10-17T15:00:00Z'), messageCount:3, firstMessage:'PRIVATE_SENTINEL', allMessagesText:'PRIVATE_SENTINEL', ...extra});
test('metadata projection never includes transcript; sanitizes terminal escapes and names', () => {
  const rows = sessionRows([session('1', {name:'\x1b]52;secret\x07\nTrabajo\u202e'})], '', '');
  assert.equal(JSON.stringify(rows).includes('PRIVATE_SENTINEL'), false);
  assert.equal(/[\x00-\x1f\u202e]/u.test(rows[0].name), false);
  assert.equal(cleanText('x'.repeat(300)).length, 100);
});
test('search is names/cwd/id only, never message text', () => {
  assert.equal(sessionRows([session('1')], 'private_sentinel', '').length, 0);
  assert.equal(sessionRows([session('1')], 'trabajo 1', '').length, 1);
});
test('save is native name + label + metadata checkpoint, no context message/tool/model call', async () => {
  const h = harness(); await h.run('guardar', 'Migración');
  assert.deepEqual(h.calls.slice(0,2), [['name','Migración'], ['label','leaf','Migración']]);
  assert.equal(h.calls[2][1], CHECKPOINT_TYPE);
  assert.equal(h.calls[2][2].targetId,'leaf');
  assert.ok(h.statuses.length);
});
test('ephemeral session cannot be advertised as saved', async () => {
  const h = harness({ephemeral:true}); await h.run('guardar','Nombre');
  assert.equal(h.calls.length,0); assert.match(h.notifications[0][0], /temporal/);
});
test('busy task is not aborted, forked or replaced', async () => {
  const h = harness({busy:true}); await h.run('sesiones'); await h.run('guardar','Name'); await h.run('puntos');
  assert.equal(h.calls.length,0); assert.equal(h.notifications.length,3);
});
test('list and native switch use real selected path; no stale context after switch', async () => {
  const h = harness({sessions:[session('1')]});
  h.answers.select.push(opts => opts[0]); await h.run('sesiones','buscar Trabajo');
  assert.equal(h.calls[0][0], 'list'); assert.deepEqual(h.calls.at(-1), ['switch','/fixture/1.jsonl']);
  assert.equal(JSON.stringify(h.calls).includes('PRIVATE_SENTINEL'),false);
});
test('active session is not unnecessarily replaced', async () => {
  const h = harness({sessions:[session('1',{path:'/fixture/active.jsonl'})]}); h.answers.select.push(o=>o[0]);
  await h.run('sesiones','Trabajo'); assert.equal(h.calls.some(c=>c[0]==='switch'),false);
});
test('pagination bounds rendered rows and selects correct second-page record', async () => {
  const h = harness({sessions:Array.from({length:PAGE_SIZE+1},(_,i)=>session(String(i).padStart(2,'0')))});
  h.answers.select.push(o=>o.find(v=>v==='Página siguiente'),o=>o[0]); await h.run('sesiones','todas');
  const selections=h.calls.filter(c=>c[0]==='select');
  assert.equal(selections[0][2].length,PAGE_SIZE+1);
  assert.deepEqual(h.calls.at(-1), ['switch','/fixture/30.jsonl']);
});
test('custom session root stays scoped to configured root', async () => {
  const h=harness(); h.ctx.sessionManager.getSessionDir=()=>'/custom/sessions'; h.ctx.sessionManager.usesDefaultSessionDir=()=>false;
  await h.run('sesiones','todas'); assert.equal(h.calls[0][0],'all'); assert.equal(h.calls[0][1],'/custom/sessions');
});
test('cross-folder cancel prevents switch', async () => {
  const h=harness({sessions:[session('1',{cwd:'/other'})]}); h.answers.select.push(o=>o[0]); h.answers.confirm.push(false);
  await h.run('sesiones','todas'); assert.equal(h.calls.some(c=>c[0]==='switch'),false);
});
test('draft requires confirmation before replacement', async () => {
  const h=harness({sessions:[session('1')]}); h.ctx.ui.getEditorText=()=>'unsent'; h.answers.select.push(o=>o[0]); h.answers.confirm.push(false);
  await h.run('sesiones','todas'); assert.equal(h.calls.some(c=>c[0]==='switch'),false);
});
test('checkpoint restoration navigates native tree with no model summary and no file rollback', async () => {
  const entries=[{id:'leaf',type:'message'},{id:'point',type:'custom',customType:CHECKPOINT_TYPE,data:{version:1,name:'Punto',targetId:'leaf',createdAt:'2026-10-17T15:00:00Z'}}];
  const h=harness({entries}); h.answers.select.push(o=>o[0]); await h.run('puntos');
  assert.deepEqual(h.calls.find(c=>c[0]==='tree'), ['tree','leaf',{summarize:false}]);
});
test('invalid checkpoints and missing targets are ignored',()=> {
  assert.deepEqual(checkpoints([{id:'x',type:'custom',customType:CHECKPOINT_TYPE,data:{version:1,name:'Oops',targetId:'missing',createdAt:'now'}}]),[]);
});
test('cancel menu and empty lists do not mutate session',async()=> {
  const h=harness(); await h.run('sesiones'); await h.run('sesiones','todas');
  assert.equal(h.calls.some(c=>['switch','new','append'].includes(c[0])),false);
});
test('listing failure returns constant error without sensitive exception text',async()=> {
  const h=harness(); h.deps.SessionManager.list=async()=>{throw new Error('PRIVATE_SENTINEL');};
  await h.run('sesiones','query'); assert.equal(JSON.stringify(h.notifications).includes('PRIVATE_SENTINEL'),false);
});
test('new session uses native replacement and does not access stale context',async()=> {
  const h=harness(); h.answers.select.push(o=>o.find(v=>v==='Nueva sesión'));
  await h.run('sesiones'); assert.deepEqual(h.calls.at(-1),['new']);
});
test('footer is terminal only and reflects ephemeral mode',async()=> {
  const h=harness({ephemeral:true}); h.events.get('session_start')({},h.ctx);
  assert.match(h.statuses[0][1],/temporal/); h.ctx.mode='json'; h.events.get('session_start')({},h.ctx); assert.equal(h.statuses.length,1);
});

test('explicit send queues one offline message; no model turn or transcript forwarding',async()=> {
  const h=harness({sessions:[session('receiver')]}); h.answers.select.push(o=>o[0]);h.answers.editor.push('Please inspect the migration plan.');
  await h.run('enviar');
  const box=new Mailboxes(h.deps.mailboxRoot);const {messages}=box.list('receiver');
  assert.equal(messages.length,1);assert.equal(messages[0].body,'Please inspect the migration plan.');
  assert.equal(h.calls.some(c=>c[0]==='sendMessage'),false);
});
test('reading inbox stays inert; import requires explicit action and triggerTurn false',async()=> {
  const h=harness();const box=new Mailboxes(h.deps.mailboxRoot);
  box.send('other','sender-session','Other','Untrusted fixture');
  h.answers.select.push(o=>o[0],o=>o[0]); await h.run('buzon');
  assert.equal(h.calls.some(c=>c[0]==='sendMessage'),false);assert.equal(box.list('sender-session').messages[0].read,true);
  h.answers.select.push(o=>o[0],o=>o[1]); await h.run('buzon');
  const sent=h.calls.find(c=>c[0]==='sendMessage');assert.ok(sent);assert.deepEqual(sent[2],{triggerTurn:false});
  assert.match(sent[1].content,/datos no confiables/);
});
test('inbox import cancellation never adds to model context',async()=> {
  const h=harness();new Mailboxes(h.deps.mailboxRoot).send('other','sender-session','Other','Fixture');
  h.answers.select.push(o=>o[0],o=>o[1]);h.answers.confirm.push(false);await h.run('buzon');
  assert.equal(h.calls.some(c=>c[0]==='sendMessage'),false);
});

test('cross-folder decision compares full raw cwd, not shared truncated display prefixes',async()=> {
  const prefix='/fixture/'+'x'.repeat(100);const h=harness({sessions:[session('1',{cwd:prefix+'/other'})]});h.ctx.cwd=prefix+'/current';
  h.answers.select.push(o=>o[0]);h.answers.confirm.push(false);await h.run('sesiones','todas');
  assert.ok(h.calls.some(c=>c[0]==='confirm'&&c[1]==='Cambiar de proyecto'));assert.equal(h.calls.some(c=>c[0]==='switch'),false);
});

test('unknown host storage capability remains within active directory instead of widening access',async()=> {
  const h=harness();delete h.ctx.sessionManager.usesDefaultSessionDir;await h.run('sesiones','todas');
  assert.equal(h.calls[0][0],'all');assert.equal(h.calls[0][1],'/fixture/sessions');
});

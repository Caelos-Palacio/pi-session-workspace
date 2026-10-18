import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, lstatSync, readdirSync, writeFileSync, linkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { Mailboxes, MAIL_LIMIT, mailboxKey } from '../mailbox.mjs';
function fixture(fn) {const root=mkdtempSync(join(tmpdir(),'pi-mail-test-'));try{return fn(root);}finally{rmSync(root,{recursive:true,force:true});}}
test('offline delivery and read receipt; no network/process/model capability',()=>fixture(root=> {
  const box=new Mailboxes(join(root,'mail'));assert.deepEqual(box.list('missing'),{messages:[],invalid:0});
  box.send('source','target','Sender','Fixture message');
  const m=box.list('target').messages[0];assert.equal(m.body,'Fixture message');assert.equal(m.read,false);
  box.markRead('target',m.id);assert.equal(box.list('target').messages[0].read,true);
  assert.equal(box.list('source').messages.length,0);
  assert.equal(lstatSync(join(root,'mail')).mode&0o777,0o700);
  assert.equal(lstatSync(join(root,'mail',mailboxKey('target'),m.slot)).mode&0o777,0o600);
}));
test('fixed message slots reject overflow without replacing existing content',()=>fixture(root=> {
  const box=new Mailboxes(join(root,'mail'));for(let i=0;i<MAIL_LIMIT;i++)box.send('source','target','Sender',`Message ${i}`);
  assert.throws(()=>box.send('source','target','Sender','Overflow'),/MAIL_FULL/);
  assert.equal(box.list('target').messages.length,MAIL_LIMIT);
  const first=box.list('target').messages[0];box.markRead('target',first.id);assert.equal(box.clearRead('target'),1);
  box.send('source','target','Sender','After explicit cleanup');assert.equal(box.list('target').messages.length,MAIL_LIMIT);
}));
test('symlink ancestors and recipient directories are rejected',()=>fixture(root=> {
  const actual=join(root,'actual');new Mailboxes(actual).send('a','b','Sender','Fixture');
  symlinkSync(actual,join(root,'link'));assert.throws(()=>new Mailboxes(join(root,'link')).list('b'),/MAIL_PATH/);
  symlinkSync(join(actual,mailboxKey('b')),join(actual,mailboxKey('evil')));
  assert.throws(()=>new Mailboxes(actual).send('a','evil','Sender','No'),/MAIL_PATH/);
}));
test('malformed, symlink and hardlink messages are not read',()=>fixture(root=> {
  const box=new Mailboxes(join(root,'mail'));box.send('a','b','Sender','Fixture');const dir=join(root,'mail',mailboxKey('b'));
  writeFileSync(join(dir,'slot-01.json'),'invalid',{mode:0o600});
  symlinkSync(join(dir,'slot-00.json'),join(dir,'slot-02.json'));
  linkSync(join(dir,'slot-00.json'),join(dir,'slot-03.json'));
  const view=box.list('b');assert.equal(view.messages.length,0);assert.equal(view.invalid,4);
}));
test('message sizes and permissive root rejected',()=>fixture(root=> {
  const box=new Mailboxes(join(root,'mail'));assert.throws(()=>box.send('a','b','Sender','x'.repeat(4001)),/MAIL_BODY/);
  box.send('a','b','Sender','Fixture');chmodSync(join(root,'mail'),0o755);
  assert.throws(()=>box.list('b'),/MAIL_PERMISSIONS/);
}));
test('parallel producers publish complete distinct messages within fixed slots',async()=> {
  const root=mkdtempSync(join(tmpdir(),'pi-mail-parallel-'));const store=join(root,'mail');new Mailboxes(store).box('target',true);
  const module=new URL('../mailbox.mjs',import.meta.url).href;
  try {
    const outcomes=await Promise.all(Array.from({length:8},(_,i)=>new Promise((done,fail)=> {
      const outcomePath=join(root,`outcome-${i}`);
      const code=`import {writeFileSync} from 'node:fs';import {Mailboxes} from ${JSON.stringify(module)};try{new Mailboxes(${JSON.stringify(store)}).send('source-${i}','target','Sender','Parallel ${i}');writeFileSync(${JSON.stringify(outcomePath)},'SENT');}catch(e){if(e.message==='MAIL_BUSY')writeFileSync(${JSON.stringify(outcomePath)},'BUSY');else throw e;}`;
      const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH}});
      let err='',out='';child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>err+=v);child.on('error',fail);child.on('close',c=>c===0?done(fs.readFileSync(outcomePath,'utf8')):fail(new Error(err)));
    })));
    const {messages,invalid}=new Mailboxes(store).list('target');const sent=outcomes.filter(v=>v==='SENT').length;assert.ok(sent>0,JSON.stringify({outcomes,messages:messages.length}));assert.equal(messages.length,sent);assert.equal(invalid,0);assert.equal(new Set(messages.map(m=>m.id)).size,sent);assert.equal(sent+outcomes.filter(v=>v==='BUSY').length,8);
  } finally {rmSync(root,{recursive:true,force:true});}
});

function patchBuiltin(name, wrapper, run) {
  const original=fs[name];fs[name]=wrapper(original);syncBuiltinESMExports();
  try{return run();}finally{fs[name]=original;syncBuiltinESMExports();}
}
test('ABA regression: another cleaner and producer cannot reuse a slot during cleanup',()=>fixture(root=> {
  const box=new Mailboxes(join(root,'mail'));
  box.send('source','target','Sender','Old read message');const old=box.list('target').messages[0];box.markRead('target',old.id);
  const slot=join(root,'mail',mailboxKey('target'),old.slot);let reached=false;
  patchBuiltin('unlinkSync',original=>path=>{
    if(path===slot&&!reached){reached=true;assert.throws(()=>box.clearRead('target'),/MAIL_BUSY/);assert.throws(()=>box.send('source','target','Sender','NEW_UNREAD'),/MAIL_BUSY/);assert.throws(()=>box.markRead('target',old.id),/MAIL_BUSY/);}
    return original(path);
  },()=>assert.equal(box.clearRead('target'),1));
  assert.ok(reached);box.send('source','target','Sender','NEW_UNREAD');
  const view=box.list('target');assert.equal(view.messages.length,1);assert.equal(view.messages[0].body,'NEW_UNREAD');assert.equal(view.messages[0].read,false);
}));
test('growth after fstat cannot cause more than 8193 bytes to be read',()=>fixture(root=> {
  const box=new Mailboxes(join(root,'mail'));box.send('source','target','Sender','Fixture');const m=box.list('target').messages[0];
  const path=join(root,'mail',mailboxKey('target'),m.slot);const inode=lstatSync(path).ino;let grew=false,totalRead=0;
  patchBuiltin('fstatSync',original=>fd=>{
    const st=original(fd);if(st.ino===inode&&!grew){grew=true;fs.appendFileSync(path,' '.repeat(20000));}return st;
  },()=>patchBuiltin('readSync',original=>(...args)=>{const n=original(...args);totalRead+=n;return n;},()=>{
    const view=box.list('target');assert.equal(view.messages.length,0);assert.equal(view.invalid,1);
  }));
  assert.ok(grew);assert.equal(totalRead,8193);
}));
test('pending creation/write failures are cleaned, existing residue is preserved and blocks sending',()=>fixture(root=> {
  const box=new Mailboxes(join(root,'mail'));const dir=box.box('target',true);const pending=join(dir,'.pending-message.json');
  patchBuiltin('writeFileSync',original=>(fd,...args)=>{
    let isPending=false;try{isPending=fs.fstatSync(fd).ino===lstatSync(pending).ino;}catch{}
    if(isPending)throw new Error('Fixture write failure');return original(fd,...args);
  },()=>assert.throws(()=>box.send('source','target','Sender','Fixture'),/Fixture write failure/));
  assert.equal(fs.existsSync(pending),false);assert.equal(fs.existsSync(join(dir,'.mutation-lock')),false);
  fs.writeFileSync(pending,'abandoned',{mode:0o600});
  assert.throws(()=>box.send('source','target','Sender','Fixture'),/MAIL_PENDING/);
  assert.equal(fs.readFileSync(pending,'utf8'),'abandoned');assert.equal(fs.existsSync(join(dir,'.mutation-lock')),false);
}));
test('nonempty lock is never stolen, expired or deleted by another writer',()=>fixture(root=> {
  const box=new Mailboxes(join(root,'mail'));const dir=box.box('target',true);const lock=join(dir,'.mutation-lock');fs.mkdirSync(lock,{mode:0o700});fs.writeFileSync(join(lock,'other.owner'),'fixture-owner',{mode:0o600});
  assert.throws(()=>box.send('source','target','Sender','Fixture'),/MAIL_BUSY/);assert.throws(()=>box.clearRead('target'),/MAIL_BUSY/);
  assert.equal(fs.readFileSync(join(lock,'other.owner'),'utf8'),'fixture-owner');
}));

test('failure after publishing reports uncertain outcome and never retries publication',()=>fixture(root=> {
  const box=new Mailboxes(join(root,'mail'));const dir=box.box('target',true);const pending=join(dir,'.pending-message.json');
  patchBuiltin('unlinkSync',original=>path=>{if(path===pending)throw new Error('Fixture cleanup failure');return original(path);},
    ()=>assert.throws(()=>box.send('source','target','Sender','Published fixture'),/MAIL_OUTCOME_UNCERTAIN/));
  assert.equal(readdirSync(dir).filter(v=>/^slot-/.test(v)).length,1);
  assert.equal(fs.existsSync(pending),true);
}));

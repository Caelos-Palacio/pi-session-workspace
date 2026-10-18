import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=mkdtempSync(join(tmpdir(),'pi-sessions-ui-'));process.env.PI_CODING_AGENT_DIR=join(root,'agent');
const packageEntry=process.env.PI_TEST_PACKAGE_ENTRY || import.meta.resolve('@earendil-works/pi-coding-agent');
const {SessionManager}=await import(packageEntry);
const assistant={role:'assistant',content:[{type:'text',text:'Respuesta ficticia para prueba local.'}],api:'anthropic-messages',provider:'anthropic',model:'claude-sonnet-4-5',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()};
const paths=[];
for(const [folder,name] of [['project-a','Prueba A'],['project-b','Prueba B']]){
 const cwd=join(root,folder);mkdirSync(cwd);const sm=SessionManager.create(cwd);
 sm.appendMessage({role:'user',content:'Mensaje ficticio, sin cuenta ni datos personales.',timestamp:Date.now()});sm.appendMessage(assistant);sm.appendSessionInfo(name);
 paths.push({id:sm.getSessionId(),path:sm.getSessionFile(),cwd});
}
writeFileSync(join(root,'metadata.json'),JSON.stringify({root,paths}));console.log(JSON.stringify({root,paths}));

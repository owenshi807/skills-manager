import {spawn,execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const binary=join(homedir(),'.skills-manager/bin/skills-manager-mcp');
const stamp=join(homedir(),'.skills-manager/bin/.mcp-version');
const allowed=new Set(['skills_manager_status','skills_agents','skills_list']);

// Keep the browser on read-only business methods; it never chooses a binary or MCP method.
export class ManagerBridge {
 constructor(){this.child=null;this.pending=new Map();this.id=0;this.starting=null;this.cache=null;this.loading=null}
 async start(){
  if(this.starting)return this.starting;
  if(this.child)return;
  this.starting=(async()=>{
   const expected=(await readFile(stamp,'utf8')).trim();
   const result=await execute(binary,['--version'],{timeout:10000,maxBuffer:16384});
   const version=result.stdout.trim().split(/\s+/).at(-1);
   if(!expected||expected!==version)throw new Error('Manager 桥接版本与安装记录不一致，请在卡牌大师中修复连接。');
   this.version=version;
   const child=spawn(binary,[],{stdio:['pipe','pipe','pipe'],shell:false});this.child=child;let buffer='';
   child.stdout.on('data',data=>{buffer+=data.toString();if(buffer.length>12*1024*1024){this.close();return}let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);let message;try{message=JSON.parse(line)}catch{continue}const p=this.pending.get(message.id);if(!p)continue;this.pending.delete(message.id);clearTimeout(p.timer);if(message.error)p.reject(new Error(message.error.message||'Manager 请求失败'));else p.resolve(message.result)}});
   child.stderr.on('data',()=>{});
   const fail=()=>{if(this.child===child)this.child=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Manager 连接已关闭'))}this.pending.clear()};child.on('error',fail);child.on('exit',fail);
   await this.request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'toy-wilds-inventory',version:'0.2.0'}});
   child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  })().catch(error=>{this.close();throw error}).finally(()=>{this.starting=null});
  return this.starting;
 }
 request(method,params){return new Promise((resolve,reject)=>{const id=++this.id;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Manager 读取超时'))},45000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(error)}})})}
 async call(name,args={}){if(!allowed.has(name))throw new Error('禁止的桥接方法');await this.start();const result=await this.request('tools/call',{name,arguments:args});if(result.isError){let m;try{m=JSON.parse(result.content.find(x=>x.type==='text').text).message}catch{}throw new Error(m||'Manager 无法读取库状态')}return result.structuredContent||JSON.parse(result.content.find(x=>x.type==='text').text)}
 async readSnapshot(){
  await this.call('skills_manager_status');const targetData=await this.call('skills_agents');let lastError;
  for(let attempt=0;attempt<2;attempt++){
   try{
    let cursor,revision;const rows=new Map();let total=0,pages=0;
    do{const data=await this.call('skills_list',{limit:200,...(cursor?{cursor}:{} )});if(revision&&revision!==data.library_revision)throw new Error('Library changed between pages');revision=data.library_revision;total=data.total;for(const item of data.skills)rows.set(item.skill.id,item);cursor=data.next_cursor;if(++pages>50)throw new Error('库分页超过范围，请缩小读取范围')}while(cursor);
    if(rows.size!==total)throw new Error('库清单不完整，尚未替换上一次快照');
    return {source:'Skill Card Manager',businessReadOnly:true,bridgeVersion:this.version,observedAt:new Date().toISOString(),revision,total,stale:false,
     targets:targetData.items.map(t=>({key:t.key,name:t.display_name,detected:!!t.installed,enabled:!!t.enabled,category:t.category})),
     skills:[...rows.values()].map(({skill:s,deployments,platform_agent_keys})=>({id:s.id,name:s.name,description:s.description||'',sourceType:s.source_type,sourceRevision:s.source_revision||null,recordedContentHash:s.content_hash||null,status:s.status,enabled:s.enabled,platformAgentKeys:platform_agent_keys||[],deployments:deployments.map(d=>({target:d.tool,actualStatus:d.actual_status,recordedStatus:d.recorded_status,mode:d.mode,lastSyncedAt:d.synced_at}))}))};
   }catch(error){lastError=error;if(!/changed between pages/i.test(error.message))throw error}
  }throw lastError;
 }
 async inventory(refresh=false){if(!refresh&&this.cache&&Date.now()-Date.parse(this.cache.observedAt)<30000)return this.cache;if(!this.loading)this.loading=this.readSnapshot().then(data=>{this.cache=data;return data}).finally(()=>{this.loading=null});try{return await this.loading}catch(error){if(this.cache)return{...this.cache,stale:true,error:'实时读取失败；当前显示上一次完整快照。'};throw error}}
 close(){const child=this.child;this.child=null;if(child)child.kill();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Manager 连接结束'))}this.pending.clear()}
}

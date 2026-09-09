// Run with Node, using the installed Multica CLI's authenticated profile.
// Raw CLI output never leaves memory; reports contain counts and status only.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {writeFile} from 'node:fs/promises';
const execute=promisify(execFile);
const binary='/Applications/Multica.app/Contents/Resources/app.asar.unpacked/resources/bin/multica';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const verbs={auth:['auth','status'],workspaces:['workspace','list','--output','json'],daemon:['daemon','status','--output','json'],agents:['agent','list','--output','json'],runtimes:['runtime','list','--output','json'],skills:['skill','list','--output','json']};
export function options(argv){
 const result={profile:null,workspace:null,agent:null,output:null};
 for(let i=0;i<argv.length;i+=2){const key={'--profile':'profile','--workspace-id':'workspace','--agent-id':'agent','--output':'output'}[argv[i]];if(!key||!argv[i+1])throw new Error('Unsupported or incomplete option');result[key]=argv[i+1]}
 if(!result.profile||!(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,90}$/).test(result.profile))throw new Error('A named CLI profile is required');
 for(const key of ['workspace','agent'])if(result[key]&&!UUID.test(result[key]))throw new Error('Workspace and agent references must be full UUIDs');
 return result;
}
export function command(kind,config){
 let args=verbs[kind];
 if(['bindings','runs'].includes(kind)){if(!UUID.test(config.agent||''))throw new Error('Agent ID required');args=kind==='bindings'?['agent','skills','list',config.agent,'--output','json']:['agent','tasks',config.agent,'--output','json']}
 if(!args)throw new Error('Read-only operation not allowed');
 const scoped=!['auth','workspaces','daemon'].includes(kind);
 if(scoped&&!UUID.test(config.workspace||''))throw new Error('Workspace ID required');
 return ['--profile',config.profile,...(scoped?['--workspace-id',config.workspace]:[]),...args];
}
const statusNames=new Set(['online','offline','idle','busy','stopped','running','queued','pending','in_progress','completed','failed','cancelled','canceled','interrupted','waiting','paused']);
export function summarize(kind,data){
 if(kind==='daemon')return{status:statusNames.has(data?.status)?data.status:'unknown'};
 if(!Array.isArray(data))throw new Error('Unexpected list schema');
 const summary={count:data.length};
 if(['agents','runtimes','runs'].includes(kind)){summary.statuses={};for(const row of data){const status=statusNames.has(row?.status)?row.status:'other';summary.statuses[status]=(summary.statuses[status]||0)+1}}
 if(kind==='agents')summary.runtimeBound=data.filter(x=>x.runtime_bound===true).length;
 if(kind==='bindings'){summary.enabled=data.filter(x=>x.enabled===true).length;summary.disabled=data.filter(x=>x.enabled===false).length;summary.enabledUnknown=data.length-summary.enabled-summary.disabled}
 return summary;
}
export function failure(error){
 const message=String(error?.stderr||'')+' '+String(error?.message||'');
 if(error?.killed||error?.code==='ETIMEDOUT')return'timeout';
 if(error?.code==='ENOENT')return'cli_missing';
 if(/No server configured/i.test(message))return'profile_not_configured';
 if(/workspace.*(required|not set|not specified)|no.*workspace/i.test(message))return'workspace_context_missing';
 if(/401|unauthorized|not authenticated|not logged in|token.*(expired|invalid)/i.test(message))return'authentication_failed';
 if(/403|forbidden|permission denied/i.test(message))return'permission_denied';
 if(/404|not found/i.test(message))return'not_found_or_hidden';
 return'command_failed';
}
export async function probe(config,runner=execute){
 const report={observedAt:new Date().toISOString(),businessReadOnly:true,profile:config.profile,cliVersion:null,checks:{},scope:{workspaceSelected:false,agentSelected:false},executionVerified:false,writePermissionVerified:false};
 // Human profile probes must not override Multica's task credential boundary.
 if(['MULTICA_TASK_ID','MULTICA_AGENT_ID','MULTICA_DAEMON_PORT'].some(key=>process.env[key])){report.blocker='run_from_human_profile_context';return report}
 try{const r=await runner(binary,['version'],{timeout:10000,maxBuffer:16384});report.cliVersion=r.stdout.match(/v?\d+\.\d+\.\d+/)?.[0]||'unknown'}catch(e){report.blocker=failure(e);return report}
 async function read(kind){
  try{
   const r=await runner(binary,command(kind,config),{timeout:30000,maxBuffer:8*1024*1024,shell:false});
   if(kind==='auth'){report.checks.auth={ok:true};return true}
   const data=JSON.parse(r.stdout);report.checks[kind]={ok:true,...summarize(kind,data)};return data;
  }catch(e){report.checks[kind]={ok:false,reason:e instanceof SyntaxError?'invalid_json':failure(e)};return null}
 }
 await read('daemon');if(!await read('auth')){report.blocker='authentication_not_verified';return report}
 const workspaces=await read('workspaces');if(!workspaces){report.blocker='workspace_list_unavailable';return report}
 if(!config.workspace&&workspaces.length===1)config={...config,workspace:workspaces[0].id};
 if(!config.workspace){report.blocker='workspace_selection_required';return report}
 if(!workspaces.some(x=>x.id===config.workspace)){report.blocker='workspace_not_in_accessible_list';return report}
 report.scope.workspaceSelected=true;
 const agents=await read('agents');await read('runtimes');await read('skills');
 if(config.agent){
  if(!agents?.some(x=>x.id===config.agent)){report.blocker='agent_not_in_accessible_list';return report}
  report.scope.agentSelected=true;await read('bindings');await read('runs');
 }
 report.result=Object.values(report.checks).every(x=>x.ok)?'read_verified':'partially_read_verified';
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const config=options(process.argv.slice(2));const report=await probe(config);const json=JSON.stringify(report,null,2)+'\n';if(config.output)await writeFile(config.output,json,{mode:0o600});process.stdout.write(json);if(report.blocker||report.result!=='read_verified')process.exitCode=2}
 catch{process.stderr.write('Probe configuration or output failed; no raw command output is logged.\n');process.exitCode=1}
}

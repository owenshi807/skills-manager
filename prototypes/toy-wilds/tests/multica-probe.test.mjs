import test from 'node:test';
import assert from 'node:assert/strict';
import {options,command,summarize,failure,probe} from '../research/multica-readonly-probe.mjs';
const wid='11111111-1111-1111-1111-111111111111',aid='22222222-2222-2222-2222-222222222222';
test('rejects arbitrary operations, profile paths, and partial identity references',()=>{
 for(const argv of [['--profile','../profile'],['--profile','ok','--token','mul_secret'],['--profile','ok','--agent-id','short']])assert.throws(()=>options(argv));
 assert.throws(()=>command('issue-create',{profile:'ok',workspace:wid}));
 assert.throws(()=>command('bindings',{profile:'ok',workspace:wid}));
 assert.deepEqual(command('bindings',{profile:'ok',workspace:wid,agent:aid}),['--profile','ok','--workspace-id',wid,'agent','skills','list',aid,'--output','json']);
});
test('projects only counts and known statuses; never raw content or secrets',()=>{
 const result=summarize('agents',[{id:aid,name:'private name',status:'idle',runtime_bound:true,mcp_config:{token:'mul_secret'},instructions:'private text'},{status:'mul_secret'}]);
 assert.deepEqual(result,{count:2,statuses:{idle:1,other:1},runtimeBound:1});
 assert.equal(failure({stderr:'403 Forbidden Bearer mul_secret'}),'permission_denied');
 assert.equal(failure({message:'private internal details'}),'command_failed');
});
test('selects a sole workspace without mutation; refuses ambiguous workspaces',async()=>{
 const calls=[];
 const runner=async(_binary,args)=>{calls.push(args);let data;if(args.includes('version'))return{stdout:'v0.4.39'};if(args.includes('auth'))return{stdout:'User: private\nToken: mul_secret'};if(args.includes('daemon'))data={status:'stopped',token:'mul_secret'};else if(args.includes('workspace'))data=[{id:wid,name:'private'}];else if(args.includes('agent'))data=[{id:aid,status:'idle'}];else data=[];return{stdout:JSON.stringify(data)}};
 const result=await probe({profile:'ok'},runner);assert.equal(result.result,'read_verified');assert.equal(result.executionVerified,false);assert.equal(result.scope.workspaceSelected,true);assert.ok(!JSON.stringify(result).includes('private'));assert.ok(!JSON.stringify(result).includes('mul_secret'));assert.ok(calls.every(args=>!args.some(x=>['create','update','switch','start','login','setup','add','set'].includes(x))));
 const ambiguous=await probe({profile:'ok'},async(binary,args)=>args.includes('workspace')?{stdout:JSON.stringify([{id:wid},{id:aid}])}:runner(binary,args));assert.equal(ambiguous.blocker,'workspace_selection_required');
});

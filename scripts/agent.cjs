#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(require('../cep/platform.cjs').dataRoot(),'agent');
const args=process.argv.slice(2),action=args.shift()||'status';
function option(name){const i=args.indexOf(name);if(i<0)return undefined;const v=args[i+1];args.splice(i,2);return v;}
const instanceId=option('--instance'),sequenceId=option('--sequence'),file=option('--file'),timeout=Number(option('--timeout')||90000);
const instances=()=>fs.existsSync(path.join(root,'instances'))?fs.readdirSync(path.join(root,'instances')).filter(f=>f.endsWith('.json')).flatMap(f=>{try{const d=JSON.parse(fs.readFileSync(path.join(root,'instances',f),'utf8'));return Date.now()-d.updatedAt<15000?[d]:[];}catch{return[];}}):[];
(async()=>{
  const live=instances();
  if(action==='status'){console.log(JSON.stringify({instances:live},null,2));return;}
  const matches=live.filter(d=>(!instanceId||d.instanceId===instanceId)&&(!sequenceId||d.sequenceId===sequenceId));
  if(matches.length!==1)throw new Error(matches.length?'Several panels match; use --instance or --sequence.':'No matching live S-Captions panel. Open Window > UXP Plugins > S-Captions.');
  const instance=matches[0],payload=file?JSON.parse(fs.readFileSync(file,'utf8')):args[0]?JSON.parse(args[0]):{};
  const allowed=['get_state','patch_style','patch_animation','set_captions','set_position','read_area','edit_area','refresh','apply','test_typing','test_history'];if(!allowed.includes(action))throw new Error('Unknown action. Use '+allowed.join(', '));
  const id=crypto.randomUUID(),request={version:1,id,instanceId:instance.instanceId,sequenceId:instance.sequenceId,createdAt:Date.now(),action,payload};
  const target=path.join(root,'requests',id+'.json'),temp=target+'.tmp';fs.writeFileSync(temp,JSON.stringify(request),{mode:0o600});fs.renameSync(temp,target);
  const response=path.join(root,'responses',id+'.json'),deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(fs.existsSync(response)){const stat=fs.lstatSync(response);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>20000000)throw new Error('Invalid caption agent response file.');const result=JSON.parse(fs.readFileSync(response,'utf8'));if(result.version!==1||result.id!==id)throw new Error('Caption agent response identity did not match.');console.log(JSON.stringify(result,null,2));fs.unlinkSync(response);if(!result.ok)process.exitCode=1;return;}await new Promise(r=>setTimeout(r,250));}
  throw new Error('The panel has not completed this request. It may still be rendering. Request ID: '+id);
})().catch(e=>{console.error(e.message);process.exitCode=1;});

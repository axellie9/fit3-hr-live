// SPDX-License-Identifier: GPL-3.0-only
import {CaptureController} from './controller.mjs';
const el=id=>document.getElementById(id);
let downloadUrl=null;
const controller=new CaptureController({bluetooth:navigator.bluetooth,onChange:render});
function render(v){
 el('status').textContent=`${v.phase} · ${v.connected?'connected':'disconnected'}${v.pending?' · pending: waiting for previous Bluetooth operation to settle':''}${v.reason?' · '+v.reason:''}${v.error?' · '+v.error:''}`;
 el('records').textContent=String(v.records);el('bytes').textContent=String(v.bytes);el('remaining').textContent=v.remainingSeconds?`${v.remainingSeconds}s`:'—';
 el('connect').disabled=v.pending||v.hasCapture||document.hidden;
 el('cancel').disabled=!v.pending||v.phase==='stopped'||v.phase==='failed';
 el('stop').disabled=v.phase!=='listening'&&!v.connected;
 el('discard').disabled=v.connected||v.pending||['choosing','connecting','subscribing','listening'].includes(v.phase)||!v.hasCapture;
 el('export').disabled=v.pending||['choosing','connecting','subscribing','listening'].includes(v.phase)||!v.hasCapture||!el('consent').checked;
}
function report(e){el('notice').textContent=String(e?.message||e);}
el('connect').addEventListener('click',()=>{el('notice').textContent='';el('consent').checked=false;controller.start().catch(report);});
el('cancel').addEventListener('click',()=>controller.stop('cancel'));
el('stop').addEventListener('click',()=>controller.stop('manual-disconnect'));
el('consent').addEventListener('change',()=>render(controller.view()));
el('discard').addEventListener('click',()=>{el('discard-decision').hidden=false;el('keep').focus();});
el('keep').addEventListener('click',()=>{el('discard-decision').hidden=true;el('discard').focus();});
el('confirm-discard').addEventListener('click',()=>{try{controller.discard();if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=null;el('consent').checked=false;el('discard-decision').hidden=true;el('notice').textContent='Capture discarded.';render(controller.view());el('connect').focus();}catch(e){report(e);}});
el('export').addEventListener('click',()=>{try{const data=controller.export(el('consent').checked);if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=downloadUrl;a.download='fit3-sensitive-raw-capture.json';a.click();el('notice').textContent='Local download requested. Not uploaded; not anonymized. Keep this file private.';el('consent').checked=false;render(controller.view());}catch(e){report(e);}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)controller.stop('hidden');render(controller.view());});
window.addEventListener('pagehide',()=>{controller.stop('pagehide');if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=null;});
render(controller.view());

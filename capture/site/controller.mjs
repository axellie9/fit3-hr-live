// SPDX-License-Identifier: GPL-3.0-only
import {chooseDevice,connectAndDiscover,subscribe} from './ble.js';
import {ProbeSession} from './session.js';
export class CaptureController {
 constructor({bluetooth,onChange=()=>{},durationMs=60000,limits={}}={}){if(!Number.isInteger(durationMs)||durationMs<1||durationMs>60000)throw Error('invalid duration');this.durationMs=durationMs;this.limits=limits;this.bluetooth=bluetooth;this.onChange=onChange;this.phase='idle';this.pending=false;this.session=null;this.meta=null;this.op=null;}
 check(){if(!this.op?.active)return false;if(performance.now()-this.startedMono>=this.durationMs){this.stop('time-limit');return false;}const stopped=this.session?._stopped;if(stopped){this.stop(stopped.reason);return false;}return true;}
 changed(){this.onChange(this.view());}
 // Cheap read-only counters from the pinned session; raw snapshot only on explicit export.
 view(){return {phase:this.phase,pending:this.pending,hasCapture:!!this.meta,records:this.session?._journal.length||0,bytes:this.session?._capturedBytes||0,connected:!!this.op?.device?.gatt?.connected,error:this.meta?.error||null,reason:this.meta?.reason||null,remainingSeconds:this.op?Math.max(0,Math.ceil((this.durationMs-(performance.now()-this.startedMono))/1000)):0};}
 async start({namePrefix='Galaxy Fit',showAllDevices=false}={}){
  if(typeof showAllDevices!=='boolean')throw Error('Explicit boolean show-all opt-in required');
  if(!showAllDevices&&(typeof namePrefix!=='string'||!namePrefix.trim()||namePrefix.trim().length>64))throw Error('Name prefix must contain 1–64 characters');
  const chooser={showAllDevices,namePrefix:showAllDevices?null:namePrefix.trim()};
  if(this.pending||this.op)throw Error('operation pending or active');
  if(this.meta)throw Error('explicit discard required');
  this.meta={connectAttemptStartedAt:Date.now(),sessionCreatedAt:null,subscriptionStartedAt:null,subscriptionSettledAt:null,status:'incomplete',reason:null,coverageComplete:false,connectionTiming:'Attempt timestamp is before chooser/GATT; session creation is not exact GATT T0.'};
  const op={active:true,device:null,link:null,listener:null,onDisconnect:()=>{if(op.active&&this.op===op)this.stop('remote-disconnect');}};this.op=op;this.pending=true;this.startedMono=performance.now();this.deadline=setTimeout(()=>this.stop('time-limit'),this.durationMs);this.poll=setInterval(()=>{this.check();this.changed();},200);this.deadline.unref?.();this.poll.unref?.();this.phase='choosing';this.changed();
  try{
   // Scoped facade preserves the pinned helper and the native Bluetooth receiver.
   const native=this.bluetooth;
   const facade=native&&typeof native.requestDevice==='function'?{requestDevice:({optionalServices})=>native.requestDevice({...chooser.showAllDevices?{acceptAllDevices:true}:{filters:[{namePrefix:chooser.namePrefix}]},optionalServices})}:undefined;
   this.meta.chooser=chooser;
   op.device=await chooseDevice(facade);
   if(!op.active||!this.check())return;
   this.phase='connecting';this.changed();
   op.link=await connectAndDiscover(op.device,{onDisconnect:op.onDisconnect,isCurrent:()=>op.active&&this.check()});
   if(!this.check())return;
   this.session=new ProbeSession({limits:this.limits});this.meta.sessionCreatedAt=Date.now();this.meta.subscriptionStartedAt=Date.now();this.phase='subscribing';this.changed();
   const ch=op.link.notifyChar;
   const wrapped={...op.link,notifyChar:{addEventListener:(type,fn)=>{op.listener=fn;ch.addEventListener(type,fn);},startNotifications:()=>ch.startNotifications()}};
   await subscribe(wrapped,bytes=>{if(!this.check())return;this.session.onNotify(bytes).catch(e=>{if(op.active)this.fail(e);});this.check();this.changed();},{isCurrent:()=>op.active&&this.check()});
   if(!op.active||!this.check())return;
   this.meta.subscriptionSettledAt=Date.now();this.phase='listening';
  }catch(e){if(op.active)this.fail(e);}finally{if(!op.active){this.cleanup(op);this.op=op.device?.gatt?.connected?op:null;}this.pending=false;this.changed();}
 }
 fail(e){this.meta.error=String(e?.message||e);this.meta.status='failed';this.stop('exception');}
 cleanup(op){
  const actions=[()=>{if(op.listener&&op.link)op.link.notifyChar.removeEventListener('characteristicvaluechanged',op.listener);},()=>op.device?.removeEventListener('gattserverdisconnected',op.onDisconnect),()=>op.device?.gatt?.disconnect()];
  for(const action of actions)try{action();}catch(e){this.meta.status='failed';this.meta.error=String(e?.message||e);this.phase='failed';}
 }
 stop(reason='manual-stop'){const op=this.op;if(!op)return;op.active=false;clearTimeout(this.deadline);clearInterval(this.poll);this.session?.invalidate();this.meta.reason=reason;this.meta.stoppedAt=Date.now();this.phase=this.meta.status==='failed'?'failed':'stopped';this.cleanup(op);if(!op.device?.gatt?.connected)this.op=null;this.changed();}
 discard(){if(this.pending||this.op)throw Error('stop and wait before discard');this.session=null;this.meta=null;this.phase='idle';this.changed();}
 export(consent){if(!consent)throw Error('explicit local export consent required');if(!this.meta)throw Error('no capture');return {schema:'fit3-passive-web-v1',metadata:{...this.meta},capture:this.session?.exportCapture()||null};}
}

// SPDX-License-Identifier: MIT
export class Session {
 constructor({limit=180,staleMs=15000}={}){this.limit=limit;this.staleMs=staleMs;this.samples=[];this.count=0;this.last=null;this.events=[];this.background=false;}
 handle(event){
  if(event.kind==='reset'){this.samples=[];this.count=0;this.last=null;}
  if(event.kind==='reading'){
   this.last={...event};this.count++;this.samples.push(this.last);
   if(this.samples.length>this.limit)this.samples.shift();
  }
 }
 record(event){this.events.push(event);if(this.events.length>200)this.events.shift();}
 lifecycle(kind,visibility,now=Date.now()){
  this.record({kind,visibility,receivedAt:new Date(now).toISOString(),backgroundTest:this.background});
  return !this.background&&(kind==='pagehide'||(kind==='visibilitychange'&&visibility==='hidden'));
 }
 setBackground(enabled,now=Date.now()){
  this.background=!!enabled;
  this.record({kind:'background-test',enabled:this.background,receivedAt:new Date(now).toISOString()});
 }
 exportData(consent){
  if(consent!==true)throw new Error('Perlu izin ekspor data kesehatan lokal.');
  return {
   schema:'fit3-web-local-v1',
   notice:'Waktu terima ponsel, bukan waktu ukur sensor. Data kandidat HRS, bukan validasi medis atau bukti kontinuitas layar terkunci. Nama/ID perangkat tidak disertakan.',
   totalSamples:this.count,retainedSamples:this.samples.length,backgroundTest:this.background,
   samples:this.samples.map(({bpm,receivedAt,contact,energyKj,rrSeconds})=>({bpm,receivedAt,contact:contact===null?'notSupported':contact?'supportedDetected':'supportedNotDetected',energyKj,rrSeconds})),
   diagnostics:this.events.map(({kind,visibility,receivedAt,backgroundTest,enabled})=>({kind,visibility,receivedAt,backgroundTest,enabled}))
  };
 }
 snapshot(now=Date.now()){
  const age=this.last?Math.max(0,now-Date.parse(this.last.receivedAt)):null;
  return {samples:this.samples.slice(),count:this.count,last:this.last,age,fresh:age!==null&&age<=this.staleMs};
 }
}

// SPDX-License-Identifier: MIT
// Manual phone-receipt snapshots only. No BLE access or automatic persistence.
export const ARCHIVE_KEY='fit3-phone-sessions-v1';
const SCHEMA='fit3-phone-archive-v1',MAX_CHARS=200000;
const keys=(o,want)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===want.split(',').sort().join(',');
const date=s=>typeof s==='string'&&s.length===24&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
const integer=(n,min,max)=>Number.isInteger(n)&&n>=min&&n<=max;
function validSample(s){return keys(s,'bpm,receivedAt,contact,energyKj,rrSeconds')&&integer(s.bpm,0,65535)&&date(s.receivedAt)&&['notSupported','supportedDetected','supportedNotDetected'].includes(s.contact)&&(s.energyKj===null||integer(s.energyKj,0,65535))&&Array.isArray(s.rrSeconds)&&s.rrSeconds.length<=32&&s.rrSeconds.every(n=>Number.isFinite(n)&&n>=0&&n<=65535/1024);}
function validEntry(e){return keys(e,'savedAt,totalSamples,backgroundTest,samples')&&date(e.savedAt)&&integer(e.totalSamples,1,Number.MAX_SAFE_INTEGER)&&typeof e.backgroundTest==='boolean'&&Array.isArray(e.samples)&&e.samples.length>0&&e.samples.length<=180&&e.totalSamples>=e.samples.length&&e.samples.every(validSample);}
export class PhoneArchive {
 constructor(storage=()=>globalThis.localStorage){this.storage=storage;}
 open(){
  let raw;try{raw=this.storage().getItem(ARCHIVE_KEY);}catch{return {ok:false,error:'denied'};}
  if(raw===null)return {ok:true,entries:[]};
  try{
   if(raw.length>MAX_CHARS)throw Error();
   const d=JSON.parse(raw);
   if(!keys(d,'schema,entries')||d.schema!==SCHEMA||!Array.isArray(d.entries)||d.entries.length>5||!d.entries.every(validEntry))throw Error();
   return {ok:true,entries:d.entries};
  }catch{return {ok:false,error:'corrupt'};}
 }
 save(data,consent){
  if(consent!==true)return {ok:false,error:'consent'};
  if(!Array.isArray(data?.samples))return {ok:false,error:'invalid'};
  if(!data.samples.length)return {ok:false,error:'empty'};
  let entry;
  try{entry={savedAt:new Date().toISOString(),totalSamples:data.totalSamples,backgroundTest:data.backgroundTest,samples:data.samples.slice(-180).map(({bpm,receivedAt,contact,energyKj,rrSeconds})=>({bpm,receivedAt,contact,energyKj,rrSeconds}))};}catch{return {ok:false,error:'invalid'};}
  if(!validEntry(entry))return {ok:false,error:'invalid'};
  const opened=this.open();if(!opened.ok)return opened;
  const {entries}=opened;
  if(entries.some(e=>e.totalSamples===entry.totalSamples&&e.backgroundTest===entry.backgroundTest&&JSON.stringify(e.samples)===JSON.stringify(entry.samples)))return {ok:false,error:'duplicate'};
  entries.push(entry);if(entries.length>5)entries.shift();
  const raw=JSON.stringify({schema:SCHEMA,entries});if(raw.length>MAX_CHARS)return {ok:false,error:'quota'};
  try{this.storage().setItem(ARCHIVE_KEY,raw);}
  catch(e){return {ok:false,error:e.name==='QuotaExceededError'?'quota':'denied'};}
  return {ok:true,entries};
 }
 clear(consent){
  if(consent!==true)return {ok:false,error:'consent'};
  try{this.storage().removeItem(ARCHIVE_KEY);return {ok:true,entries:[]};}catch{return {ok:false,error:'denied'};}
 }
}

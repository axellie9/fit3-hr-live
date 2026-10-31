// SPDX-License-Identifier: MIT
// Standard HRS only; receipt time is added by the transport, not the sensor.
export const HRS_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb';
export const HRS_MEASUREMENT = '00002a37-0000-1000-8000-00805f9b34fb';
export function parseHeartRate(input) {
 const bytes = ArrayBuffer.isView(input) ? new Uint8Array(input.buffer,input.byteOffset,input.byteLength) : new Uint8Array(input);
 let offset=1;
 const need=n=>{if(offset+n>bytes.length)throw new Error('Paket HRS terpotong');};
 if(!bytes.length)throw new Error('Paket HRS kosong');
 const flags=bytes[0];
 if(flags&0xe0)throw new Error('Flag HRS reserved tidak didukung');
 const u16=()=>{need(2);const v=bytes[offset]|bytes[offset+1]<<8;offset+=2;return v;};
 need(flags&1?2:1);
 const bpm=flags&1?u16():bytes[offset++];
 const energyKj=flags&8?u16():null;
 const rrSeconds=[];
 if(flags&16){need(2);while(offset<bytes.length)rrSeconds.push(u16()/1024);}
 if(offset!==bytes.length)throw new Error('Panjang paket HRS tidak sesuai flag');
 return {bpm,contact:flags&4?!!(flags&2):null,energyKj,rrSeconds};
}

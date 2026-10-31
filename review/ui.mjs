// SPDX-License-Identifier: MIT
import {HeartRateProbe} from './probe.mjs';
import {Session} from './session.mjs';
const $=id=>document.getElementById(id);
const session=new Session();
let pending=false;
function render(){
 const s=session.snapshot();
 $('bpm').textContent=s.last?String(s.last.bpm):'—';
 $('count').textContent=String(s.count);$('retained').textContent=`${s.samples.length} / 180`;
 $('freshness').textContent=!s.last?'BELUM ADA DATA':s.fresh?'BARU DITERIMA':'DATA LAMA';
 $('freshness').dataset.fresh=s.last?String(s.fresh):'';
 $('age').textContent=s.last?`Diterima ${Math.floor(s.age/1000)} dtk lalu${s.fresh?'':' · lewat batas 15 dtk'}.`:'Menunggu pembacaan baru.';
 if(s.last){
  const r=s.last;
  $('details').textContent=`Terima ponsel: ${r.receivedAt} (bukan waktu ukur gelang). Kontak: ${r.contact===null?'tidak didukung':r.contact?'terdeteksi':'tidak terdeteksi'}. Energi: ${r.energyKj===null?'—':r.energyKj+' kJ'}. RR: ${r.rrSeconds.length?r.rrSeconds.map(x=>x.toFixed(3)+' dtk').join(', '):'—'}.`;
 }else $('details').textContent='Waktu yang ditampilkan adalah waktu terima ponsel, bukan waktu ukur gelang.';
 const values=s.samples.map(r=>r.bpm),lo=values.length?Math.min(...values):0,hi=values.length?Math.max(...values):0;
 const points=values.map((v,i)=>[8+(values.length===1?0:i/(values.length-1)*304),90-(v-lo)/(hi-lo||1)*70]);
 $('trace').setAttribute('points',points.map(p=>p.join(',')).join(' '));
 $('dots').replaceChildren();
 if(points.length===1){const c=document.createElementNS('http://www.w3.org/2000/svg','circle');c.setAttribute('cx',points[0][0]);c.setAttribute('cy',points[0][1]);c.setAttribute('r','3');$('dots').append(c);}
 $('range').textContent=values.length?`${lo}–${hi} bpm · skala otomatis`:'Belum ada data';
 $('log').textContent=session.events.length?session.events.slice(-20).map(e=>JSON.stringify(e)).join('\n'):'Belum ada peristiwa.';
 $('connect').disabled=pending||!!probe.device||!window.isSecureContext||!navigator.bluetooth?.requestDevice;
 $('disconnect').disabled=!pending&&!probe.device;
 $('export').disabled=!$('export-consent').checked;
}
function emit(event){
 session.handle(event);
 // Only fixed event kinds/timestamps retained; device names and exception text stay out of export.
 session.record({kind:event.kind,receivedAt:new Date().toISOString()});
 if(event.kind==='reset'){
  $('status').textContent='Tidak tersambung. Sesi dibersihkan; hubungkan untuk data baru.';
  $('device').textContent='Belum ada perangkat dipilih.';
  $('export-consent').checked=false;$('export-status').textContent='';
 }
 if(event.kind==='device')$('device').textContent=`Dipilih: ${event.name}. Identitas belum diverifikasi.`;
 if(event.kind==='status')$('status').textContent=event.text.startsWith('Choose')?'Pilih perangkat sendiri; cocokkan dengan layar gelang.':event.text.startsWith('Subscribed')?'Menunggu notifikasi HRS baru. Terhubung bukan bukti pembacaan.':event.text;
 if(event.kind==='error')$('status').textContent='Paket HRS ditolak: format tidak lengkap atau tidak didukung. Sampel tidak dihitung.';
 render();
}
const probe=new HeartRateProbe({bluetooth:navigator.bluetooth,emit});
$('environment').textContent=`Konteks aman: ${window.isSecureContext?'ya':'tidak'}. Web Bluetooth: ${navigator.bluetooth?.requestDevice?'tersedia':'tidak tersedia; di iPhone gunakan Bluefy, bukan Safari'}. Tes browser desktop bukan tes iPhone.`;
if(!window.isSecureContext||!navigator.bluetooth?.requestDevice)$('status').textContent='Tidak didukung di browser/konteks ini. Buka lewat HTTPS di Bluefy dan izinkan Bluetooth.';
$('connect').onclick=async()=>{
 pending=true;$('status').textContent='Membuka pemilih Bluetooth…';render();
 try{await probe.connect();}
 catch(error){
  const messages={NotFoundError:'Pemilihan dibatalkan atau layanan HRS tidak ditemukan. Coba lagi tanpa reset gelang.',NotAllowedError:'Izin Bluetooth ditolak. Periksa izin Bluefy/iOS.',SecurityError:'Akses Bluetooth diblokir. Gunakan HTTPS dan periksa izin.',NetworkError:'Koneksi Bluetooth gagal/terputus. Dekatkan gelang dan coba lagi.',NotSupportedError:'Layanan atau notifikasi HRS tidak didukung oleh perangkat/browser.'};
  $('status').textContent=messages[error.name]||'Belum berhasil menghubungkan HRS. Coba lagi; jangan reset gelang. Ini bukan bukti semua koneksi Fit3 mustahil.';
  session.record({kind:'connection-error',receivedAt:new Date().toISOString()});
 }finally{pending=false;render();}
};
$('disconnect').onclick=()=>{probe.disconnect();render();};
$('background-test').onchange=()=>{
 session.setBackground($('background-test').checked);
 $('mode').textContent=session.background?'Mode uji latar AKTIF: halaman tidak memutus saat tersembunyi. Kontinuitas belum terbukti.':'Mode foreground. Kembali ke halaman tidak menyambung otomatis.';
 if(!session.background&&document.visibilityState==='hidden')probe.disconnect();
 render();
};
function lifecycle(event){
 const disconnect=session.lifecycle(event.type,document.visibilityState);
 if(disconnect)probe.disconnect();
 render();
}
document.addEventListener('visibilitychange',lifecycle);
window.addEventListener('pagehide',lifecycle);window.addEventListener('pageshow',lifecycle);
$('export-consent').onchange=render;
$('export').onclick=()=>{
 if(!$('export-consent').checked)return;
 const data=session.exportData(true);
 const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download='fit3-sesi-lokal.json';a.click();
 setTimeout(()=>URL.revokeObjectURL(url),2000);
 $('export-consent').checked=false;$('export-status').textContent='Permintaan unduh dikirim ke browser; periksa file unduhan Anda.';render();
};
setInterval(render,1000);render();

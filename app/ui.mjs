// SPDX-License-Identifier: MIT
import {HeartRateProbe} from './probe.mjs';
import {Session} from './session.mjs';
import {PhoneArchive} from './archive.mjs';
import {startPwa} from './pwa.mjs';
const $=id=>document.getElementById(id);
const session=new Session();
const archive=new PhoneArchive();
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
 $('archive-save').disabled=!$('archive-consent').checked||!s.samples.length;
 $('archive-hint').textContent=s.samples.length?`${s.samples.length} sampel sesi tersedia untuk salinan manual. Maks. 5 sesi × 180 sampel; simpan ke-6 mengganti arsip tertua.`:'Terima minimal satu notifikasi di Ringkasan sebelum menyimpan.';
}
function emit(event){
 session.handle(event);
 // Only fixed event kinds/timestamps retained; device names and exception text stay out of export.
 session.record({kind:event.kind,receivedAt:new Date().toISOString()});
 if(event.kind==='reset'){
  $('status').textContent='Tidak tersambung. Sesi dibersihkan; hubungkan untuk data baru.';
  $('device').textContent='Belum ada perangkat dipilih.';
  $('export-consent').checked=false;$('export-status').textContent='';
  $('archive-consent').checked=false;$('archive-status').textContent='';
 }
 if(event.kind==='device')$('device').textContent=`Dipilih: ${event.name}. Identitas belum diverifikasi.`;
 if(event.kind==='status')$('status').textContent=event.text.startsWith('Choose')?'Pilih perangkat sendiri; cocokkan dengan layar gelang.':event.text.startsWith('Subscribed')?'Menunggu notifikasi HRS baru. Terhubung bukan bukti pembacaan.':event.text;
 if(event.kind==='reading')$('status').textContent='Notifikasi HRS diterima di ponsel. Bukan riwayat gelang atau validasi medis.';
 if(event.kind==='error')$('status').textContent='Paket HRS ditolak: format tidak lengkap atau tidak didukung. Sampel tidak dihitung.';
 render();
}
const probe=new HeartRateProbe({bluetooth:navigator.bluetooth,emit});
$('environment').textContent=`Konteks aman: ${window.isSecureContext?'ya':'tidak'}. Web Bluetooth: ${navigator.bluetooth?.requestDevice?'tersedia':'tidak tersedia; di iPhone gunakan Bluefy, bukan Safari'}. Tes browser desktop bukan tes iPhone.`;
if(!window.isSecureContext||!navigator.bluetooth?.requestDevice){
 $('status').textContent='Tidak didukung di browser/konteks ini. Buka lewat HTTPS di Bluefy dan izinkan Bluetooth.';
 $('connect').textContent='Bluetooth tidak tersedia';$('open-bluefy').hidden=false;
}
$('open-bluefy').onclick=()=>{showView('device');$('bluefy-guide').open=true;$('bluefy-guide').querySelector('summary').focus();};
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
// Only explicit open/save actions access archive storage. Never hydrate Session.
const archiveErrors={consent:'Perlu persetujuan untuk salinan ini.',empty:'Belum ada sampel sesi untuk disimpan.',duplicate:'Salinan sesi ini sudah ada; tidak disimpan dua kali.',denied:'Penyimpanan browser ditolak atau tidak tersedia. Gunakan ekspor JSON.',quota:'Arsip tidak tersimpan: ruang/batas penyimpanan penuh. Gunakan ekspor JSON atau hapus arsip.',corrupt:'Arsip rusak atau format tidak dikenal. Tidak ditimpa. Ekspor sesi aktif tetap tersedia.',invalid:'Sampel tidak sesuai batas arsip. Tidak tersimpan; ekspor JSON tetap tersedia.'};
function renderArchive(result){
 const root=$('archive-list');root.replaceChildren();
 if(!result.ok){$('archive-status').textContent=archiveErrors[result.error];return;}
 if(!result.entries.length){const p=document.createElement('p');p.className='small';p.textContent='Belum ada arsip sesi ponsel.';root.append(p);return;}
 for(const entry of [...result.entries].reverse()){
  const item=document.createElement('details');item.className='archive-entry inline-details';
  const summary=document.createElement('summary');summary.textContent=`${entry.samples.length} sampel · ${new Date(entry.samples[0].receivedAt).toLocaleString('id-ID')}`;
  const info=document.createElement('p');info.className='small';
  const values=entry.samples.map(s=>s.bpm);
  info.textContent=`ARSIP SESI PONSEL · ${Math.min(...values)}–${Math.max(...values)} bpm. Total diterima: ${entry.totalSamples}; salinan: ${entry.samples.length} sampel. Terima pertama: ${entry.samples[0].receivedAt}. Terima terakhir: ${entry.samples.at(-1).receivedAt}. Disimpan: ${entry.savedAt}. Uji latar: ${entry.backgroundTest?'aktif, bukan bukti kontinuitas':'tidak aktif'}. Bukan riwayat gelang; tidak dimuat ke monitor.`;
  item.append(summary,info);root.append(item);
 }
}
$('archive-clear').onclick=()=>$('clear-dialog').showModal();
$('clear-cancel').onclick=()=>$('clear-dialog').close();
$('clear-dialog').addEventListener('close',()=>$('archive-clear').focus({preventScroll:true}));
$('clear-confirm').onclick=()=>{
 const result=archive.clear(true);
 renderArchive(result);
 $('archive-consent').checked=false;
 $('archive-status').textContent=result.ok?'Semua arsip lokal dihapus. Sesi aktif dan file unduhan tidak berubah.':archiveErrors[result.error];
 $('clear-dialog').close();render();
};
$('archive-consent').onchange=render;
$('archive-open').onclick=()=>{$('archive-status').textContent='';renderArchive(archive.open());};
$('archive-save').onclick=()=>{
 if(!$('archive-consent').checked)return;
 const result=archive.save(session.exportData(true),true);
 $('archive-consent').checked=false;
 if(result.ok){renderArchive(result);$('archive-status').textContent='Tersimpan di browser ini: salinan sesi ponsel, bukan riwayat gelang.';}
 else $('archive-status').textContent=archiveErrors[result.error];
 render();
};
// Navigation changes views only, never the Bluetooth/foreground lifecycle policy.
const tabs=[...document.querySelectorAll('[data-view]')];
function showView(id,{focus=false}={}){
 if(!tabs.some(t=>t.dataset.view===id))id='summary';
 for(const tab of tabs){const active=tab.dataset.view===id;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;$(tab.getAttribute('aria-controls')).hidden=!active;}
 history.replaceState(null,'',`#${id}`);
 window.scrollTo(0,0);
 if(focus)tabs.find(t=>t.dataset.view===id).focus({preventScroll:true});
}
for(const [index,tab] of tabs.entries()){
 tab.onclick=()=>showView(tab.dataset.view);
 tab.onkeydown=e=>{let next;if(e.key==='ArrowRight')next=(index+1)%tabs.length;if(e.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;if(e.key==='Home')next=0;if(e.key==='End')next=tabs.length-1;if(next!==undefined){e.preventDefault();showView(tabs[next].dataset.view,{focus:true});}};
}
for(const button of document.querySelectorAll('[data-go]'))button.onclick=()=>showView(button.dataset.go,{focus:true});
document.querySelector('.wordmark').onclick=e=>{e.preventDefault();showView('summary',{focus:true});};
window.addEventListener('hashchange',()=>showView(location.hash.slice(1)));
showView(location.hash.slice(1));
setInterval(render,1000);render();
startPwa({isBleBusy:()=>pending||!!probe.device});

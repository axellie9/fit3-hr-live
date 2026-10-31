// SPDX-License-Identifier: MIT
// App-shell capability is independent of Bluetooth and local health archives.
export function startPwa({isBleBusy}){
 const status=document.getElementById('pwa-status');
 const network=document.getElementById('pwa-network');
 const networkState=()=>{network.textContent=navigator.onLine?'Jaringan dilaporkan online; bukan bukti server dapat dijangkau.':'Jaringan dilaporkan offline. Bluetooth adalah kemampuan terpisah.';};
 networkState();window.addEventListener('online',networkState);window.addEventListener('offline',networkState);
 if(!isSecureContext||!navigator.serviceWorker){status.textContent='Service worker tidak tersedia. Mode online biasa; offline belum siap. Bluetooth diperiksa terpisah di monitor.';return;}
 const base=new URL('./',import.meta.url);
 async function refresh(reg){
  if(!reg.active){status.textContent='Menyiapkan cache tampilan; offline belum siap.';return;}
  try{
   const result=await new Promise((resolve,reject)=>{
    const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();reject(Error());},2500);
    channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data);};
    reg.active.postMessage({type:'STATUS'},[channel.port2]);
   });
   status.textContent=result.ready?`Siap offline · tampilan ${result.version}. Cache dapat dihapus browser; bukan cadangan arsip atau jaminan BLE.`:'Cache tampilan tidak lengkap; offline belum siap. Halaman saat ini tetap dapat dipakai.';
  }catch{status.textContent='Status cache belum dapat diperiksa; offline belum terverifikasi. Halaman saat ini tetap dapat dipakai.';}
 }
 navigator.serviceWorker.register(new URL('sw.js',base),{scope:base.href,updateViaCache:'none'}).then(reg=>{
  const apply=document.getElementById('pwa-apply'),check=document.getElementById('pwa-check'),update=document.getElementById('pwa-update');
  let authorized=false,deferred=false,activationTimer;
  const authorize=()=>{
   authorized=true;apply.disabled=true;clearTimeout(activationTimer);
   activationTimer=setTimeout(()=>{authorized=false;apply.disabled=false;update.textContent='Pembaruan belum selesai. Halaman saat ini tetap dipakai; periksa atau coba terapkan lagi. Tidak ada muat ulang otomatis.';},5000);
  };
  const reloadIfIdle=()=>{
   clearTimeout(activationTimer);authorized=false;
   if(isBleBusy()){deferred=true;apply.disabled=false;apply.hidden=false;update.textContent='Pembaruan aktif, muat ulang ditunda karena Bluetooth/pemilih aktif. Putuskan dahulu lalu terapkan lagi.';return;}
   location.reload();
  };
  const waiting=()=>{if(reg.waiting&&reg.waiting!==initialWorker){apply.hidden=false;update.textContent='Pembaruan menunggu. Ekspor sesi RAM dahulu, putuskan Bluetooth, lalu terapkan secara manual.';}};
  const initialWorker=reg.active||reg.installing;
  const watch=worker=>{
   if(!worker)return;let previous=worker.state;
   worker.addEventListener('statechange',()=>{
    const failed=worker.state==='redundant'&&['installing','installed'].includes(previous);previous=worker.state;
    refresh(reg);waiting();
    if(failed){
     authorized=false;apply.disabled=false;apply.hidden=!reg.waiting;
     update.textContent='Pemasangan pembaruan gagal. Versi saat ini tetap digunakan; coba periksa lagi saat online.';
     if(!reg.active)status.textContent='Pemasangan cache gagal; offline belum siap. Halaman online dan Bluetooth tetap dapat dipakai.';
    }
    if(worker.state==='activated'){
     if(authorized)reloadIfIdle();
     else if(worker!==initialWorker){deferred=true;apply.hidden=false;apply.disabled=false;update.textContent='Pembaruan sudah aktif untuk navigasi berikutnya. Ekspor dahulu; terapkan manual saat Bluetooth tidak aktif.';}
    }
   });
  };
  watch(reg.installing);reg.addEventListener('updatefound',()=>{watch(reg.installing);refresh(reg);});
  check.disabled=false;
  check.onclick=async()=>{check.disabled=true;update.textContent='Memeriksa pembaruan…';try{await reg.update();if(!reg.installing&&!reg.waiting)update.textContent='Belum ada pembaruan baru. Tidak ada muat ulang otomatis.';waiting();}catch{update.textContent='Pemeriksaan gagal. Versi saat ini tetap digunakan; coba lagi saat online.';}finally{check.disabled=false;}};
  apply.onclick=()=>{
   if(isBleBusy()){update.textContent='Putuskan Bluetooth / batalkan pemilih dahulu. Sesi aktif tidak dimuat ulang.';return;}
   if(deferred){reloadIfIdle();return;}
   if(!reg.waiting){
    if(reg.active&&reg.active!==initialWorker){authorize();if(reg.active.state==='activated')reloadIfIdle();return;}
    update.textContent='Pembaruan tidak lagi menunggu. Periksa lagi; tidak dimuat ulang.';return;
   }
   authorize();update.textContent='Menerapkan pembaruan yang Anda pilih…';reg.waiting.postMessage({type:'ACTIVATE'});
  };
  navigator.serviceWorker.addEventListener('message',event=>{
   if(event.data?.type==='ACTIVATION_BLOCKED'&&event.source?.scriptURL===new URL('sw.js',base).href){
    clearTimeout(activationTimer);authorized=false;apply.disabled=false;
    update.textContent='Pembaruan ditunda: tutup tab/tampilan lain untuk aplikasi ini dahulu. Sesi di tab lain tidak diubah. Ekspor sesi sebelum menutup.';
   }
  });
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(authorized)reloadIfIdle();});
  const recheck=()=>refresh(reg);
  window.addEventListener('online',recheck);window.addEventListener('offline',recheck);window.addEventListener('pageshow',recheck);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')recheck();});
  refresh(reg);waiting();
 }).catch(()=>{status.textContent='Pemasangan cache gagal; offline belum siap. Gunakan halaman online ini; koneksi Bluetooth tidak diubah.';});
}

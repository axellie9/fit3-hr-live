// SPDX-License-Identifier: MIT
import { HRS_SERVICE, HRS_MEASUREMENT, parseHeartRate } from './hrs.mjs';
export class HeartRateProbe {
  constructor({ bluetooth, emit = () => {}, now = () => new Date() }) { this.bluetooth=bluetooth; this.emit=emit; this.now=now; this.generation=0; }
  async connect() {
    if(this.busy) throw new Error('Tunggu upaya sebelumnya selesai; jangan mulai koneksi tumpang tindih.');
    this.busy=true;
    try { return await this.connectAttempt(); }
    catch(error) { this.disconnect(); throw error; }
    finally { this.busy=false; }
  }
  async connectAttempt() {
    this.disconnect();
    const generation=this.generation;
    if (!this.bluetooth?.requestDevice) throw new Error('Web Bluetooth unavailable; on iPhone this probe needs Bluefy, not Safari.');
    this.emit({kind:'status',text:'Choose Galaxy Fit3; device identity must be checked by you.'});
    const device=await this.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:[HRS_SERVICE]});
    if (generation!==this.generation) return;
    this.device=device;
    this.emit({kind:'device',name:this.device.name || '(unnamed)'});
    this.onDisconnected=()=>{if(generation===this.generation)this.disconnect();};
    this.device.addEventListener('gattserverdisconnected',this.onDisconnected);
    const server=await device.gatt.connect();
    if (generation!==this.generation) {
      if(this.device!==device) device.gatt.disconnect();
      return;
    }
    const service=await server.getPrimaryService(HRS_SERVICE);
    if (generation!==this.generation) return;
    const characteristic=await service.getCharacteristic(HRS_MEASUREMENT);
    if (generation!==this.generation) return;
    this.characteristic=characteristic;
    this.onReading=e=>{
      if (generation!==this.generation) return;
      try {
        const value=e.target.value;
        const reading=parseHeartRate(value);
        const rawHex=Array.from(new Uint8Array(value.buffer,value.byteOffset,value.byteLength),n=>n.toString(16).padStart(2,'0')).join('');
        this.emit({kind:'reading',...reading,receivedAt:this.now().toISOString(),rawHex,source:'Bluetooth HRS 0x2A37'});
      } catch(error) {this.emit({kind:'error',text:error.message});}
    };
    this.characteristic.addEventListener('characteristicvaluechanged',this.onReading);
    await this.characteristic.startNotifications();
    if (generation!==this.generation) return;
    this.emit({kind:'status',text:'Subscribed. No health reading proven until a real notification arrives.'});
  }
  disconnect() {
    this.generation++;
    if (this.characteristic && this.onReading) this.characteristic.removeEventListener('characteristicvaluechanged',this.onReading);
    if (this.device && this.onDisconnected) this.device.removeEventListener('gattserverdisconnected',this.onDisconnected);
    this.device?.gatt?.disconnect();
    this.device=null;this.characteristic=null;this.onReading=null;this.onDisconnected=null;
    this.emit({kind:'reset'});
  }
}

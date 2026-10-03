'use strict';
/** Developer-only controller for local Roku connectors. No ECP originates here.
 * Each connector independently requires consent and validates its own device.
 * Alignment advances trailing players first; it never seeks past ads or a paywall.
 */
const crypto = require('node:crypto');
const SERVICES = new Set(['netflix','hulu','disney','prime','max','youtube','paramount']);
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const clean = (v, max=120) => typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,max) : '';
const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 172800;
class TVSession {
 constructor({emit, now=Date.now}) { this.emit=emit; this.now=now; }
 entries(r) { if (!r.tv) r.tv=new Map(); return r.tv; }
 public(r) { return [...this.entries(r).values()].filter(t=>r.members.has(t.id)).map(t=>({
  id:t.id,ownerId:t.ownerId,name:t.name,provider:t.provider,contentKey:t.contentKey,
  state:t.state,positionSec:t.positionSec,armed:t.armed,canRead:t.canRead,
  observedAt:t.observedAt||0,note:t.note||'Waiting for device readback.',driftSec:t.driftSec??null
 })); }
 state(r) { return {devices:this.public(r),alignment:r.tvPlan ? {id:r.tvPlan.id,phase:r.tvPlan.phase,message:r.tvPlan.message||'',startAt:r.tvPlan.startAt||null}:null}; }
 publish(r) { return this.emit(r,'tv_state',this.state(r)); }
 event(r,t,op,extra={}) { return this.emit(r,'tv_command',{target:t.id,op,...extra}); }
 invalidate(r,message) {
  const plan=r.tvPlan;if(plan&&['pausing','scheduled','running'].includes(plan.phase)) {
   plan.phase='stopped';plan.message=message;
   for(const t of this.entries(r).values()) this.event(r,t,'cancel',{alignmentId:plan.id});
  }
 }
 drop(r,id) { if(!this.entries(r).delete(id))return;this.invalidate(r,'A TV connector disconnected. Align again after reconnecting.');this.publish(r); }
 requireHost(r,m) {if(r.hostId!==m.id)fail(403,'Only the room host can coordinate all TVs.');}
 eligible(r) {
  const devices=[...this.entries(r).values()].filter(t=>r.members.has(t.id));
  if(devices.length<2)fail(409,'Connect at least two TVs to measure a shared alignment.');
  if(!r.sync||r.sync.mode!=='external')fail(409,'Choose the external TV session first.');
  for(const t of devices) {
   if(!t.armed||!t.canRead||!finite(t.positionSec)||this.now()-t.observedAt>5000||!['playing','paused'].includes(t.state))fail(409,'Every TV must confirm the same episode, supply a recent timestamp, and be out of ads/buffering.');
   if(t.provider!==r.sync.provider||t.contentKey!==r.sync.contentKey)fail(409,'All TVs must confirm the same service and episode key.');
  }
  return devices;
 }
 align(r) {
  const devices=this.eligible(r);
  if(r.tvPlan&&['pausing','scheduled'].includes(r.tvPlan.phase))fail(409,'An alignment is already in progress.');
  const plan={id:crypto.randomBytes(12).toString('hex'),phase:'pausing',targets:devices.map(t=>t.id),paused:new Map(),started:new Set(),created:this.now(),deadline:this.now()+10000,provider:r.sync.provider,contentKey:r.sync.contentKey,message:'Reading paused positions from each Roku.'};
  r.tvPlan=plan;
  for(const t of devices)this.event(r,t,'pause',{alignmentId:plan.id});
  return this.publish(r);
 }
 tick(r) {
  const p=r.tvPlan;if(!p)return;
  if(['pausing','scheduled'].includes(p.phase)&&this.now()>p.deadline){this.invalidate(r,'A TV did not confirm playback in time. No further automatic controls will run.');this.publish(r);}
 }
 handle(r,m,p) {
  if(!p.type.startsWith('tv_'))return null;
  this.tick(r);
  const devices=this.entries(r);
  if(p.type==='tv_register') {
   if(!SERVICES.has(p.provider))fail(400,'Unknown service.');
   if(!r.members.has(p.ownerId)||devices.has(p.ownerId))fail(400,'Pair from a connected browser.');
   if(devices.size>=6&&!devices.has(m.id))fail(409,'Up to six local TV connectors per room.');
   if(p.consent!==true)fail(403,'Local device-control consent is required.');
   const t={id:m.id,ownerId:p.ownerId,name:clean(m.name,32),provider:p.provider,contentKey:'',state:'unconfirmed',positionSec:null,armed:false,canRead:false,observedAt:0};
   devices.set(m.id,t);return this.publish(r);
  }
  if(p.type==='tv_status') {
   const t=devices.get(m.id);if(!t)fail(403,'Register this local connector first.');
   const previousKey=t.contentKey;
   t.state=['playing','paused','buffering','unavailable','unconfirmed','stopped'].includes(p.state)?p.state:'unavailable';
   t.positionSec=finite(p.positionSec)?p.positionSec:null;t.canRead=p.canRead===true&&t.positionSec!==null;
   t.contentKey=clean(p.contentKey);t.armed=p.armed===true&&t.canRead;t.note=clean(p.note,180);
   if(typeof p.observedAt!=='number'||p.observedAt>this.now()+1000||this.now()-p.observedAt>5000){t.canRead=false;t.armed=false;}
   t.observedAt=typeof p.observedAt==='number'?p.observedAt:this.now();
   t.driftSec=typeof p.driftSec==='number'&&Number.isFinite(p.driftSec)?Math.max(-9999,Math.min(9999,p.driftSec)):null;
   const plan=r.tvPlan;
   if(plan&&['pausing','scheduled','running'].includes(plan.phase)&&(!t.armed||!t.canRead||(previousKey&&previousKey!==t.contentKey)||t.provider!==plan.provider||t.contentKey!==plan.contentKey))this.invalidate(r,'Playback identity, position, or permission changed. Confirm all episodes and align again.');
   return this.publish(r);
  }
  if(p.type==='tv_action') {
   const action=p.action;
   if(action==='align'){this.requireHost(r,m);return this.align(r);}
   if(action==='pause_all'){
    this.requireHost(r,m);
    for(const t of devices.values())if(t.armed)this.event(r,t,'pause',{alignmentId:''});this.invalidate(r,'Paused by the room host.');return this.publish(r);
   }
   const t=devices.get(p.target);if(!t)fail(404,'That TV connector is not online.');
   if(t.ownerId!==m.id)fail(403,'Only the paired browser can operate this TV.');
   if(!['launch','confirm','disarm','disconnect'].includes(action))fail(400,'Unknown TV action.');
   if(action==='confirm'){
    if(p.noAds!==true||!clean(p.contentKey)||r.sync.mode!=='external'||r.sync.provider!==t.provider||r.sync.contentKey!==clean(p.contentKey))fail(409,'Confirm the exact episode and an uninterrupted, ad-free content segment first.');
    return this.event(r,t,'confirm',{contentKey:clean(p.contentKey),noAds:true});
   }
   if(action!=='launch')this.invalidate(r,'A participant stopped or changed device control.');
   return this.event(r,t,action);
  }
  if(p.type==='tv_result') {
   const t=devices.get(m.id);if(!t)fail(403,'Unknown TV connector.');
   t.note=clean(p.message,180)||'Device response received.';
   const plan=r.tvPlan;
   if(!plan||p.alignmentId!==plan.id||!plan.targets.includes(t.id))return this.publish(r);
   if(p.ok!==true){this.invalidate(r,t.note);return this.publish(r);}
   if(plan.phase==='pausing'&&p.op==='pause'&&p.state==='paused'&&finite(p.positionSec)){
    plan.paused.set(t.id,p.positionSec);
    if(plan.paused.size===plan.targets.length){
     const values=[...plan.paused.values()],lo=Math.min(...values),hi=Math.max(...values);
     if(hi-lo>30){this.invalidate(r,'TVs are more than 30 seconds apart. Manually choose a common scene, then Align again.');return this.publish(r);}
     plan.phase='scheduled';plan.startAt=this.now()+4000;plan.deadline=plan.startAt+(hi-lo)*1000+12000;
     plan.message='Starting trailing TVs first. No content is skipped.';
     for(const id of plan.targets)this.event(r,devices.get(id),'play_at',{alignmentId:plan.id,startAt:plan.startAt+(plan.paused.get(id)-lo)*1000,anchorPosition:plan.paused.get(id)});
     const s={...r.sync,status:'live',positionSec:lo,serverTime:plan.startAt,from:r.hostId,hold:false};delete s.type;delete s.seq;delete s.ts;
     r.sync=this.emit(r,'sync',s);
    }
   } else if(plan.phase==='scheduled'&&p.op==='play_at'&&p.state==='playing'){
    plan.started.add(t.id);if(plan.started.size===plan.targets.length){plan.phase='running';plan.message='Start commands confirmed. Compare live reported positions below.';}
   }
   return this.publish(r);
  }
  fail(400,'Unknown TV session action.');
 }
}
module.exports={TVSession};

'use strict';
const assert=require('node:assert/strict');
const {NativeVoice}=require('../lib/native-voice');
const {nativeRequestMember,applyRequestBudget}=require('../lib/request-budget');
const base=process.env.BASE_URL||'http://127.0.0.1:7802';
let n=0,requestId=0;const pass=s=>console.log('PASS',++n,s);
const equal=(a,b)=>typeof a==='string'&&a===b;
(async()=>{
 const rooms=new Map([['testroom',{members:new Map([['one',{id:'one',grant:'private1'}],['two',{id:'two',grant:'private2'}]])}]]);
 const url=new URL('http://local/api/rooms/testroom/voice/pull');
 const req={method:'POST',headers:{'x-client-id':'one','x-session-grant':'private1'}};
 assert.equal(nativeRequestMember(req,url.pathname,url.searchParams,rooms,equal).id,'one');pass('private grant identifies the per-member request budget');
 for(const r of [{...req,headers:{'x-client-id':'one','x-session-grant':'bad'}},{...req,headers:{'x-client-id':'missing','x-session-grant':'private1'}}])assert.equal(nativeRequestMember(r,url.pathname,url.searchParams,rooms,equal),null);pass('forged or missing identity cannot acquire the authenticated budget');
 assert.equal(nativeRequestMember(req,'/api/rooms/new',url.searchParams,rooms,equal),null);assert.equal(nativeRequestMember(req,'/api/rooms/another/voice/pull',url.searchParams,rooms,equal),null);pass('room and endpoint boundaries preserve public request protection');
 const calls=[];applyRequestBudget(req,url,rooms,equal,(...args)=>calls.push(args),'shared');assert.deepEqual(calls,[['edge:shared',12000,60000],['member-http:one',900,60000]]);pass('both aggregate gateway and individual limits remain enforced');
 let clock=1000;const emitted=[];const nv=new NativeVoice({clock:()=>clock,broadcast:(r,id,client,b)=>emitted.push(Buffer.from(b))});
 const open=nv.open('r',{id:'a',name:'A',kind:'roku'},{adultNonChildSession:true},0);assert.equal(open.atomicEndOfTalk,true);const sa=nv.sessions.get(open.voiceId);
 const other=nv.open('r',{id:'b',name:'B',kind:'roku'},{adultNonChildSession:true},1);const sb=nv.sessions.get(other.voiceId);
 const final=Buffer.alloc(640);final.writeInt16LE(12345,0);final.writeInt16LE(-2345,638);
 const packet={seq:1,pcm:final.toString('base64'),format:'pcm-s16-le',sampleRate:16000,channels:1,muted:false,endOfTalk:true};
 const ack=nv.push(sa,packet);assert.equal(ack.frames,1);assert.equal(ack.muted,true);assert.equal(emitted.length,1);assert(emitted[0].equals(final));pass('push-to-talk release delivers the complete final frame then marks muted');
 assert(Buffer.from(nv.pull(sb).wav,'base64').subarray(44).equals(final));pass('the final sample survives native WAV return mixing');
 assert.equal(nv.push(sa,packet).duplicate,true);assert.equal(emitted.length,1);pass('repeated release acknowledgements cannot replay audio');
 clock+=800;nv.accept('r','src','c',final);clock+=800;assert.equal(nv.pull(sb).frames,0);pass('old voice is discarded instead of replayed on reconnection');
 async function http(path,b,member){const res=await fetch(base+path,{method:b===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(member?{'X-Client-Id':member.clientId,'X-Session-Grant':member.nativeVoiceGrant}:{})},body:b===undefined?undefined:JSON.stringify(b)});return {status:res.status,data:await res.json()}}
 const created=await http('/api/rooms/new',{});assert.equal(created.status,201);const prefix='/api/rooms/'+created.data.room+'/';
 const members=[];for(const name of ['Hardware-protocol-test-A','Hardware-protocol-test-B']){const r=await http(prefix+'join',{name,kind:'roku'});assert.equal(r.status,200);members.push(r.data)}
 const host=members[0];
 async function event(p){return http(prefix+'event',{clientId:host.clientId,reqId:'t'+(++requestId),...p},host)}
 // Two devices behind the same IP: old global budget failed before 1400.
 let count=0;const responses=[];
 for(let batch=0;batch<140;batch++){
  const block=await Promise.all(Array.from({length:10},(_,j)=>http(prefix+'moments?clientId='+members[j%2].clientId,undefined,members[j%2])));
  for(const r of block){assert.equal(r.status,200,'authenticated NAT traffic rejected at '+count);count++}
 }
 pass('1400 actual HTTP requests from two authenticated Roku sessions on one IP succeed');
 assert.equal((await http(prefix+'moments?clientId='+host.clientId,undefined,{...host,nativeVoiceGrant:'forged'})).status,403);pass('wrong private grant still fails over the real HTTP server');
 let r=await event({type:'sync',mediaUrl:'https://media.example.com/film.mp4',mediaTitle:'Authorized test URL - not fetched',runtimeSec:0,positionSec:0,status:'paused'});assert.equal(r.status,200);
 let poll=await http(prefix+'poll?since=0&clientId='+host.clientId,undefined,host);assert.equal(poll.data.sync.runtimeSec,0);pass('unknown movie duration does not inherit the 24-second sample length');
 r=await event({type:'sync',mediaUrl:'https://media.example.com/film2.m3u8',format:'hls',positionSec:0,status:'paused'});assert.equal(r.status,200);poll=await http(prefix+'poll?since=0&clientId='+host.clientId,undefined,host);assert.equal(poll.data.sync.runtimeSec,0);pass('changing to another unknown-length stream resets its duration');
 r=await event({type:'sync',mediaUrl:'https://media.example.com/film2.m3u8',format:'hls',runtimeSec:7200,positionSec:120,status:'live',sampledAt:Date.now()-800});assert.equal(r.status,200);poll=await http(prefix+'poll?since=0&clientId='+host.clientId,undefined,host);assert.equal(poll.data.sync.runtimeSec,7200);assert(poll.data.ts-poll.data.sync.serverTime>=790);pass('two-hour duration and an 800ms observation age are retained');
 for(const u of ['https://www.netflix.com/watch/123','https://www.hulu.com/watch/123','https://www.paramountplus.com/shows/test/video/id/']){r=await event({type:'sync',mediaUrl:u,positionSec:0,status:'paused'});assert.equal(r.status,400);assert(r.data.error.includes('official app'))}pass('subscription website pages produce actionable errors, not broken native media loads');
 r=await event({type:'sync',mediaUrl:'https://sub.localhost/video.mp4',positionSec:0,status:'paused'});assert.equal(r.status,400);pass('localhost subdomains cannot be submitted as public media');
 const voice=await http(prefix+'voice/open',{clientId:host.clientId,adultNonChildSession:true},host);assert.equal(voice.status,200);assert.equal(voice.data.atomicEndOfTalk,true);
 const vbody={clientId:host.clientId,voiceId:voice.data.voiceId,voiceSecret:voice.data.voiceSecret};
 r=await http(prefix+'voice/push',{...vbody,...packet},host);assert.equal(r.status,200);assert.equal(r.data.frames,1);assert.equal(r.data.muted,true);pass('atomic end-of-talk is negotiated and acknowledged through real native HTTP routes');
 await http(prefix+'voice/close',vbody,host);
 for(const m of members)await http(prefix+'leave',{clientId:m.clientId},m);
 assert.equal((await http('/api/health')).status,200);pass('server remains healthy after authorization and media rejections');
 console.log('Repair assertions complete. Native HTTP clients and unit audio are not physical Roku hardware.');
})().catch(e=>{console.error(e);process.exitCode=1});

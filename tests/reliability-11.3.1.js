'use strict';
const assert=require('node:assert/strict');
const {range,stats,sticker}=require('../lib/protocol-support');
const {WebSocket:WS}=require('ws');
const base=process.env.BASE_URL||'http://127.0.0.1:7811';
let count=0;const pass=t=>console.log('PASS',++count,t);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 assert.deepEqual(range('bytes=-16',100),{start:84,end:99,status:206});pass('suffix byte ranges serve the actual final bytes');
 assert.deepEqual(range('bytes=20-',100),{start:20,end:99,status:206});assert.deepEqual(range('bytes=90-200',100),{start:90,end:99,status:206});pass('open-ended and beyond-EOF ranges are correctly bounded');
 for(const x of ['bytes=-0','bytes=100-','bytes=5-2','bytes=0-2,5-8','bytes=-','bytes=9007199254740993-'])assert.throws(()=>range(x,100),e=>e.status===416);pass('malformed, multiple and unsafe numeric ranges fail cleanly');
 assert.deepEqual(stats({rttMs:999999,driftMs:-Infinity,playerState:'pl\u0000aying'},123),{rttMs:60000,driftMs:0,playerState:'playing',updatedAt:123});pass('shared health metrics are finite, bounded, and control-character free');
 assert.equal(sticker('hi :lol: !'),'lol');assert.equal(sticker(':notallowed:'),'');pass('only the eight packaged sticker names can be forwarded');
 const newRoom=await fetch(base+'/api/rooms/new',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(newRoom.status,201);const {room}=await newRoom.json();const prefix=base+'/api/rooms/'+room+'/';
 const w=new WS(base.replace(/^http/,'ws')+'/ws?room='+room+'&name=Same');const packets=[];w.on('message',b=>packets.push(JSON.parse(b.toString())));await new Promise((r,j)=>{w.once('open',r);w.once('error',j)});
 async function until(predicate){for(let n=0;n<150;n++){const x=predicate();if(x)return x;await wait(20)}throw Error('Timed out waiting for packet');}
 const hello=await until(()=>packets.find(p=>p.type==='welcome'));
 const joined=await fetch(prefix+'join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Same',kind:'roku'})});const native=await joined.json();assert.equal(joined.status,200);
 let req=0;async function event(p,who=native){const r=await fetch(prefix+'event',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Grant':who.nativeVoiceGrant,'X-Client-Id':who.clientId},body:JSON.stringify({clientId:who.clientId,reqId:'z'+(++req),...p})});return {r,p:await r.json()};}
 w.send(JSON.stringify({type:'stats',rttMs:42,driftMs:100,playerState:'playing',reqId:'health-host'}));
 const ack=await event({type:'stats',rttMs:75,driftMs:-250,playerState:'paused'});assert.equal(ack.r.status,200);
 const metrics=await until(()=>packets.find(p=>p.type==='stats'&&Object.keys(p.clients).length===2));
 assert.equal(Object.values(metrics.clients).filter(x=>x.name==='Same').length,2);assert(Object.values(metrics.clients).some(x=>x.rttMs===75));pass('real WebSocket receives both native REST and browser health within three seconds; duplicate names survive');
 const before=packets.filter(p=>p.type==='stats').length;
 for(let i=0;i<5;i++)w.send(JSON.stringify({type:'stats',rttMs:i,driftMs:0,playerState:'paused'}));
 await wait(1200);assert.equal(packets.filter(p=>p.type==='stats').length,before+1);pass('burst health reports coalesce instead of flooding every viewer');
 const chat=await event({type:'chat',text:'Ready :hype:'});assert.equal(chat.r.status,200);const message=await until(()=>packets.find(p=>p.type==='chat'&&p.text==='Ready :hype:'));assert.equal(message.sticker,'hype');pass('Roku REST chat forwards the packaged sticker to the actual browser socket');
 const file=await fetch(base+'/media/orbit.mp4');const bytes=Buffer.from(await file.arrayBuffer());assert(file.ok);
 const suffix=await fetch(base+'/media/orbit.mp4',{headers:{Range:'bytes=-32'}});assert.equal(suffix.status,206);assert(Buffer.from(await suffix.arrayBuffer()).equals(bytes.subarray(-32)));assert.equal(suffix.headers.get('content-range'),`bytes ${bytes.length-32}-${bytes.length-1}/${bytes.length}`);pass('actual HTTP suffix response exactly matches the movie bytes and Content-Range');
 const bad=await fetch(base+'/media/orbit.mp4',{headers:{Range:'bytes=99999999-'}});assert.equal(bad.status,416);assert.equal(bad.headers.get('content-range'),`bytes */${bytes.length}`);assert((await bad.json()).error);pass('unsatisfiable ranges return 416 with length, not a truncated movie or server crash');
 const head=await fetch(base+'/media/orbit.mp4',{method:'HEAD',headers:{Range:'bytes=-32'}});assert.equal(head.status,206);assert.equal(head.headers.get('content-length'),'32');assert.equal((await head.arrayBuffer()).byteLength,0);pass('HEAD ranges advertise length without returning movie data');
 const reject=await event({type:'sync',positionSec:0,status:'live'});assert.equal(reject.r.status,403);pass('a follower still cannot control the room after diagnostics changes');
 for(const who of [native,hello])await fetch(prefix+'leave',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Grant':who.nativeVoiceGrant},body:JSON.stringify({clientId:who.clientId})});
 w.send(JSON.stringify({type:'chat',text:'not a member anymore',reqId:'revoked'}));const revoked=await until(()=>packets.find(p=>p.type==='error'&&p.reqId==='revoked'));assert(revoked.error.includes('expired'));pass('revoked WebSocket membership cannot send buffered actions');
 w.close();assert((await fetch(base+'/api/health')).ok);pass('server remains healthy after invalid ranges, revoked actions and session cleanup');
 console.log(count+' reliability checks passed. Native clients are protocol clients, not physical TVs.');
})().catch(e=>{console.error(e);process.exitCode=1;setTimeout(()=>process.exit(1),100).unref()});

'use strict';
const fs=require('node:fs');
const file='web/app.js';let s=fs.readFileSync(file,'utf8');
if(s.includes('ORBIT_GESTURE_VOICE_V1')){console.log('Voice activation fix already present');process.exit(0)}
const start=s.indexOf('async function startVoice()'),end=s.indexOf('\nfunction stopVoice()',start);
if(start<0||end<0)throw Error('Unexpected voice implementation; review before patching');
const replacement=String.raw`async function startVoice(){
 // ORBIT_GESTURE_VOICE_V1: start audio inside the user's click, before permission awaits.
 if(!connected())return notify('Join a room first.');
 if(S.voice||S.voiceStarting)return;
 if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)return notify('Voice needs the secure hosted website and microphone permission.');
 const gen=S.generation,attempt={ctx:null,stream:null};S.voiceStarting=attempt;
 const current=()=>S.generation===gen&&S.voiceStarting===attempt;
 const cleanup=()=>{attempt.stream?.getTracks().forEach(t=>t.stop());if(attempt.ctx&&attempt.ctx.state!=='closed')attempt.ctx.close().catch(()=>{})};
 const bounded=async(p,ms,label)=>{let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms)})])}finally{clearTimeout(timer)}};
 let ctx,stream;
 try{
  ctx=attempt.ctx=new (window.AudioContext||window.webkitAudioContext)();
  const resume=ctx.resume();resume.catch(()=>{});
  $('talk').textContent='Cancel microphone setup';$('voiceStatus').textContent='Waiting for microphone permission…';
  stream=attempt.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
  if(!current()){cleanup();return}
  $('voiceStatus').textContent='Starting audio…';
  await bounded(resume,8000,'Audio did not start. Tap Talk together again.');
  if(!current()){cleanup();return}
  $('voiceStatus').textContent='Loading microphone capture…';
  await bounded(ctx.audioWorklet.addModule('/capture-worklet.js'),10000,'Microphone module did not load. Check your connection.');
  if(!current()){cleanup();return}
  const source=ctx.createMediaStreamSource(stream),worklet=new AudioWorkletNode(ctx,'orbit-capture'),zero=ctx.createGain();
  zero.gain.value=0;source.connect(worklet).connect(zero).connect(ctx.destination);
  const u=new URL('/voice',location.href);u.protocol=location.protocol==='https:'?'wss:':'ws:';
  u.searchParams.set('room',S.room);u.searchParams.set('clientId',S.id);u.searchParams.set('grant',S.grant);
  const ws=new WebSocket(u);ws.binaryType='arraybuffer';
  const voice={ws,stream,ctx,source,worklet,zero,from:'',times:new Map(),openTimer:null};
  S.voice=voice;S.voiceStarting=null;S.rxFrames=0;S.txFrames=0;duckMusic();
  $('voiceStatus').textContent='Connecting your voice to the room…';
  voice.openTimer=setTimeout(()=>{if(S.voice===voice&&ws.readyState!==1){stopVoice();notify('Voice connection timed out. Tap Talk together to retry.')}},10000);
  ws.onopen=()=>{clearTimeout(voice.openTimer);if(S.voice!==voice){ws.close();return}$('talk').textContent='🎙 Microphone on · turn off';$('talk').setAttribute('aria-pressed','true');$('voiceStatus').textContent='Voice connected. Your microphone is live.'};
  worklet.port.onmessage=e=>{if(S.voice!==voice||ws.readyState!==1)return;if(ws.bufferedAmount<65536){ws.send(e.data);S.txFrames++}};
  ws.onmessage=e=>{
   if(S.voice!==voice)return;
   if(typeof e.data==='string'){let p;try{p=JSON.parse(e.data)}catch{return}if(p.type==='voice_frame')voice.from=p.from;if(p.type==='voice_state')$('voiceStatus').textContent='Microphone live · '+(p.roster?.length||1)+' in voice';return}
   if(!(e.data instanceof ArrayBuffer)||e.data.byteLength!==640)return;
   S.rxFrames++;const buffer=ctx.createBuffer(1,320,16000),x=buffer.getChannelData(0),dv=new DataView(e.data);
   for(let j=0;j<320;j++)x[j]=dv.getInt16(j*2,true)/32768;
   const node=ctx.createBufferSource();node.buffer=buffer;node.connect(ctx.destination);
   let t=Math.max(ctx.currentTime+.04,voice.times.get(voice.from)||0);if(t>ctx.currentTime+.4)t=ctx.currentTime+.04;
   node.start(t);if(voice.times.size>24)voice.times.delete(voice.times.keys().next().value);voice.times.set(voice.from,t+.02);node.onended=()=>node.disconnect();
  };
  ws.onerror=()=>{};ws.onclose=()=>{clearTimeout(voice.openTimer);if(S.voice===voice){stopVoice();notify('Voice disconnected. Tap Talk together to retry.')}};
  stream.getAudioTracks().forEach(t=>t.onended=()=>{if(S.voice===voice)stopVoice()});
 }catch(e){
  cleanup();if(S.voiceStarting!==attempt)return;S.voiceStarting=null;
  $('talk').textContent='🎙 Talk together';$('talk').setAttribute('aria-pressed','false');$('voiceStatus').textContent='Microphone is off. Tap Talk together to retry.';
  notify(e.name==='NotAllowedError'?'Microphone permission was not granted. You can still watch and type.':e.message||'Voice could not start. You can still watch and type.');duckMusic();
 }
}`;
s=s.slice(0,start)+replacement+s.slice(end);
s=s.replace('if(S.voice)return stopVoice();','if(S.voice||S.voiceStarting)return stopVoice();');
s=s.replace('function stopVoice(){const v=S.voice;',"function stopVoice(){const pending=S.voiceStarting;S.voiceStarting=null;if(pending){pending.stream?.getTracks().forEach(t=>t.stop());if(pending.ctx&&pending.ctx.state!=='closed')pending.ctx.close().catch(()=>{})}const v=S.voice;");
s=s.replace('if(v){try{v.ws.close()}catch{}','if(v){clearTimeout(v.openTimer);try{v.ws.close()}catch{}');
fs.writeFileSync(file,s);console.log('Updated voice activation, progress, cancellation, and bounded waits');

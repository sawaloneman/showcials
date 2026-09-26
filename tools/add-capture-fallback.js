'use strict';
const fs=require('node:fs'),f='web/app.js';let s=fs.readFileSync(f,'utf8');
if(s.includes('ORBIT_CAPTURE_FALLBACK_V1')){console.log('Capture compatibility present');process.exit(0)}
const helper=String.raw`function compatibleCapture(ctx){
 // ORBIT_CAPTURE_FALLBACK_V1: legacy fallback only if AudioWorklet cannot start.
 if(!ctx.createScriptProcessor)throw Error('This browser cannot start microphone capture.');
 const node=ctx.createScriptProcessor(2048,1,1),port={onmessage:null};
 let tail=new Float32Array(0),position=0,frame=new Int16Array(320),used=0;
 const step=ctx.sampleRate/16000;
 node.onaudioprocess=e=>{
  for(let c=0;c<e.outputBuffer.numberOfChannels;c++)e.outputBuffer.getChannelData(c).fill(0);
  const x=e.inputBuffer.getChannelData(0),b=new Float32Array(tail.length+x.length);b.set(tail);b.set(x,tail.length);
  while(position+1<b.length){const n=Math.floor(position),fraction=position-n,v=Math.max(-1,Math.min(1,b[n]*(1-fraction)+b[n+1]*fraction));frame[used++]=Math.round(v*(v<0?32768:32767));if(used===320){port.onmessage?.({data:frame.buffer});frame=new Int16Array(320);used=0}position+=step}
  const consumed=Math.min(Math.floor(position),b.length-1);tail=b.slice(consumed);position-=consumed;
 };
 return {node,port};
}
`;
const old="  await bounded(ctx.audioWorklet.addModule('/capture-worklet.js'),10000,'Microphone module did not load. Check your connection.');\n  if(!current()){cleanup();return}\n  const source=ctx.createMediaStreamSource(stream),worklet=new AudioWorkletNode(ctx,'orbit-capture'),zero=ctx.createGain();";
const next="  let modern=true;try{if(!ctx.audioWorklet)throw Error('AudioWorklet unavailable');await bounded(ctx.audioWorklet.addModule('/capture-worklet.js'),2500,'Capture startup delayed')}catch{modern=false}\n  if(!current()){cleanup();return}\n  const source=ctx.createMediaStreamSource(stream),fallback=modern?null:compatibleCapture(ctx),worklet=modern?new AudioWorkletNode(ctx,'orbit-capture'):fallback.node,zero=ctx.createGain(),capturePort=modern?worklet.port:fallback.port;\n  S.captureEngine=modern?'AudioWorklet':'Compatibility capture';";
if(!s.includes(old))throw Error('Voice source changed; review patch');
s=s.replace(old,next).replace('async function startVoice(){',helper+'async function startVoice(){');
s=s.replace('  const resume=ctx.resume();resume.catch(()=>{});',"  const driver=ctx.createConstantSource(),quiet=ctx.createGain();quiet.gain.value=0;driver.connect(quiet).connect(ctx.destination);driver.start();\n  const resume=ctx.resume();resume.catch(()=>{});");
s=s.replace('  worklet.port.onmessage=e=>','  capturePort.onmessage=e=>');
fs.writeFileSync(f,s);console.log('Capture keeps modern AudioWorklet plus a bounded legacy compatibility path');

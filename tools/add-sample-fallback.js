'use strict';
// One-time source migration: add the same original film in another browser codec.
const fs=require('node:fs');
const changes=[];
function replace(file,before,after){const s=fs.readFileSync(file,'utf8');if(s.includes(after))return;if(!s.includes(before))throw Error('Source changed; review '+file);changes.push([file,s.replace(before,after)]);}
replace('server.js',"'/media/orbit.mp4':['orbit.mp4','video/mp4'],","'/media/orbit.mp4':['orbit.mp4','video/mp4'],'/media/orbit.webm':['orbit.webm','video/webm'],'/compat.js':['compat.js','text/javascript; charset=utf-8'],");
replace('web/index.html','<script src="/app.js" defer></script>','<script src="/app.js" defer></script><script src="/compat.js" defer></script>');
replace('build-media.js',"try{const f=path.join(path.dirname(require.resolve('hls.js'))",`execFileSync('ffmpeg',['-y','-loglevel','error','-i','web/orbit.mp4','-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','6','-crf','38','-b:v','0','-c:a','libopus','-b:a','48k','web/orbit.webm'],{stdio:'inherit'});
try{const f=path.join(path.dirname(require.resolve('hls.js'))`);
const compat=`'use strict';
// Same film and room clock; choose another local codec only after a decode error.
(() => {
 const v=document.getElementById('video');
 let fallbackGeneration=-1;
 v.addEventListener('error',()=>{
  const s=window.SC;
  if(!s||fallbackGeneration===s.mediaGeneration||!v.error)return;
  const original=s.sync?.mediaUrl;
  const offline=!!window.ORBIT_OFFLINE||location.protocol==='file:';
  if(typeof original!=='string'||!original)return;
  const isSample=original==='/media/orbit.mp4'||(offline&&original===window.ORBIT_DEMO);
  if(!isSample)return;
  if(offline&&!window.ORBIT_WEBM)return;
  fallbackGeneration=s.mediaGeneration;
  s.suppressUntil=performance.now()+2000;
  document.getElementById('toast').textContent='Switching to a compatible video format…';
  v.src=offline?window.ORBIT_WEBM:'/media/orbit.webm';
  v.load();
 },false);
})();
`;
if(fs.existsSync('web/compat.js')&&fs.readFileSync('web/compat.js','utf8')!==compat)throw Error('Refusing to overwrite a different compatibility module');
changes.push(['web/compat.js',compat]);
for(const[p,s]of changes)fs.writeFileSync(p,s);
console.log('Updated explicit source files:',changes.map(x=>x[0]).join(', '));

'use strict';
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

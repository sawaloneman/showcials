'use strict';
/* Optional hardware-validation UI. A device timestamp is never inferred from a button click. */
(()=>{
 let state={devices:[],alignment:null};let root=null,rows=null,summary=null;
 const labels={netflix:'Netflix',hulu:'Hulu',disney:'Disney+',prime:'Prime Video',max:'Max',youtube:'YouTube',paramount:'Paramount+'};
 function act(action,extra={}){return send('tv_action',{action,...extra}).catch(e=>notify(e.message));}
 function render(){
  if(!root||!root.isConnected||!rows?.isConnected||!summary?.isConnected||!$('dialog').open)return;
  rows.replaceChildren();summary.textContent=state.alignment?.message||'No measured alignment yet. Connect two TVs and confirm the same episode.';
  for(const t of state.devices){
   const row=el('section','tv-device');row.append(el('h3','',t.name+' · '+(labels[t.provider]||t.provider)));
   const age=Math.max(0,(serverNow()-t.observedAt)/1000);
   const current=age<5;
   paragraph(row,(t.canRead&&current?'Reported position: '+time(t.positionSec):'Position unavailable')+' · '+(current?t.state:'status is stale'));
   paragraph(row,t.note,'fine');
   if(t.driftSec!==null&&t.driftSec!==undefined&&current)paragraph(row,'Reported difference from room clock: '+Number(t.driftSec).toFixed(2)+' seconds.','fine');
   if(t.ownerId===S.id){
    button(row,'Open '+(labels[t.provider]||'official app')+' on this Roku',()=>act('launch',{target:t.id}),'secondary');
    button(row,t.armed?'Confirm episode again':'Confirm the episode on my TV',()=>confirm(t),'secondary');
    button(row,'Stop this TV connector',()=>act('disconnect',{target:t.id}),'text-button');
   }
   rows.append(row);
  }
  if(!state.devices.length)paragraph(rows,'No local Roku connector is connected. A cloud server cannot reach your home TV by itself.');
 }
 function confirm(t){
  const c=modal('Check the episode on your TV.');
  paragraph(c,'Every participant must choose the same service, episode and version. This tool cannot verify your subscription or universally detect advertisements.');
  paragraph(c,'Room episode: '+(S.sync?.mediaTitle||'Not selected'));
  const l=el('label','setting','My TV shows this exact episode, outside any advertisement, in an uninterrupted ad-free content segment.');
  const i=el('input');i.type='checkbox';l.append(i);c.append(l);
  button(c,'Confirm this TV',async()=>{if(!i.checked)return notify('Check your TV and confirm the notice first.');await act('confirm',{target:t.id,noAds:true,contentKey:S.sync?.contentKey||''});open();});
  paragraph(c,'Use Stop controls during any ad, buffering, episode change or unexpected movement. Never use alignment to skip an ad.','fine');
 }
 function open(){
  const c=modal('Your subscriptions. On your Roku.');root=c;
  paragraph(c,'Developer hardware test · provider compatibility unverified or a published Roku Store integration.','tv-notice');
  if(!connected()||S.preview){
   paragraph(c,'First start or join a real room. Subscription playback stays in the official Roku app; Showcials keeps chat and voice in this browser.');
   button(c,'Start a room',showStart);button(c,'Join a room',()=>showJoin(),'secondary');return;
  }
  paragraph(c,'1. Choose the same episode');
  const lab=el('label','','Streaming service'),select=el('select');select.id='tv-service';lab.htmlFor=select.id;
  for(const [value,title]of Object.entries(labels)){const o=el('option','',title);o.value=value;select.append(o)}select.value=labels[S.sync?.provider]?S.sync.provider:'netflix';
  c.append(lab,select);
  const title=field(c,'Movie or episode name','Example: Our show, season 1, episode 2',S.sync?.mode==='external'?S.sync.mediaTitle:'');title.maxLength=120;
  const key=field(c,'Shared episode key','Example: show-s1-e2-original',S.sync?.mode==='external'?S.sync.contentKey:'');key.maxLength=120;
  const b=button(c,'Use this episode for the room',async()=>{
   if(!title.value.trim()||!key.value.trim())return notify('Enter the episode name and shared key.');
   try{await send('sync',{mode:'external',provider:select.value,mediaTitle:title.value.trim(),contentKey:key.value.trim(),mediaUrl:'',runtimeSec:0,positionSec:0,status:'paused'});notify('Episode selected. Now connect and confirm each TV.');}catch(e){notify(e.message)}
  });b.disabled=!isHost();if(!isHost())paragraph(c,'The room host selects the episode. Your local TV must match it.','fine');
  paragraph(c,'2. Connect your own TV');
  paragraph(c,'Run the small connector on a computer on the same Wi-Fi/LAN as Roku. It asks for the TV address and your local consent, never a Netflix/Hulu password. Developer Mode is required by this test tool.');
  const link=el('a','primary','Get the local Roku connector');link.href='/roku-connector.py';link.download='roku-connector.py';c.append(link);
  const cmd=el('pre','tv-command');cmd.tabIndex=0;
  const command=()=>`${/Win/i.test(navigator.platform)?'py':'python3'} roku-connector.py --developer-validation --room ${S.room} --owner ${S.id} --service ${select.value} --server ${location.origin==='null'?'https://showcials-orbit-production.up.railway.app':location.origin}`;
  const update=()=>{cmd.textContent=command()};select.onchange=update;update();c.append(cmd);
  button(c,'Copy connector command',()=>navigator.clipboard.writeText(command()).then(()=>notify('Copied. Run it in the folder containing the connector.')).catch(()=>notify('Select and copy the command above.')),'secondary');
  paragraph(c,'Roku’s ECP developer documentation restricts third-party control. This opt-in validation path is not an approval or exemption; confirm permission before commercial distribution.','fine');
  paragraph(c,'3. Confirm the episode, then align');
  summary=el('p','tv-notice');summary.setAttribute('role','status');rows=el('div','tv-devices');c.append(summary,rows);
  const align=button(c,'Align TVs',()=>act('align'));align.disabled=!isHost();
  const stop=button(c,'Pause all TVs',()=>act('pause_all'),'secondary');stop.disabled=!isHost();
  paragraph(c,'Alignment pauses each confirmed player, reads its position, then starts trailing TVs earlier. No seek, hidden provider API or video extraction is used. Larger gaps, missing timestamps and rejected commands stop the test.','fine');
  paragraph(c,'Chat and Talk together stay here while Netflix/Hulu is open on Roku. This does not keep the Showcials app or remote microphone running behind another Roku app.','fine');render();
 }
 window.ShowcialsTV={open};
 window.addEventListener('showcials-tv',e=>{state=e.detail||{devices:[],alignment:null};render();});
 const controls=document.querySelector('.room-tools');if(controls){const b=el('button','soft','Connect Roku TV');b.id='tvConnect';b.onclick=open;controls.prepend(b);}
 const oldTick=tick;tick=function(){oldTick();if(S.sync?.mode==='external'){
  $('syncStatus').textContent=state.alignment?.message||'External Roku session · no measured alignment yet.';
  $('filmDescription').textContent='Use the official Roku app for the subscription. Keep this browser open for chat and voice.';
  for(const id of ['play','seek','backTen','forwardTen'])$(id).disabled=true;
  $('mark').disabled=true;
 }else $('mark').disabled=false;};
})();

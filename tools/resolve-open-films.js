'use strict';
// Build-time only: fixed, credited Creative Commons films. No user-supplied URLs.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..'),file=path.join(root,'web/library.json');
const data=JSON.parse(fs.readFileSync(file,'utf8'));
const plans={
 'sintel':{index:'https://download.blender.org/durian/movies/',match:/sintel.*(?:1024|1280).*\.mp4$/i,urls:['https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8','https://download.blender.org/durian/movies/sintel-1024-surround.mp4']},
 'tears-of-steel':{index:'https://download.blender.org/mango/ToS/',match:/tears.*(?:720|1080).*\.(?:mp4|mov)$/i,urls:['https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8','https://download.blender.org/mango/ToS/tears_of_steel_720p.mov']},
 'big-buck-bunny':{index:'https://download.blender.org/peach/bigbuckbunny_movies/',match:/bigbuckbunny.*(?:320|640|720).*\.(?:mp4|m4v)$/i,urls:['https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8','https://download.blender.org/peach/bigbuckbunny_movies/BigBuckBunny_640x360.m4v']},
 'elephants-dream':{index:'https://download.blender.org/ED/',match:/(?:ED_|elephant).*\.(?:mp4|mov)$/i,urls:['https://download.blender.org/ED/ED_1024_512kb.mp4','https://download.blender.org/ED/ED_1024.mp4']}
};
async function indexCandidates(plan){try{const r=await fetch(plan.index,{signal:AbortSignal.timeout(10000)});if(!r.ok)return [];const text=await r.text();if(text.length>1000000)return [];return [...text.matchAll(/href="([^"]+)"/g)].map(x=>new URL(x[1],plan.index)).filter(u=>u.origin===new URL(plan.index).origin&&u.pathname.startsWith(new URL(plan.index).pathname)&&plan.match.test(u.pathname)).map(u=>u.href).slice(0,5)}catch{return []}}
async function checkURL(url){const r=await fetch(url,{method:'GET',headers:{Range:'bytes=0-1023'},signal:AbortSignal.timeout(12000)});await r.body?.cancel();if(!r.ok)throw Error('HTTP '+r.status)}
function probe(url){const raw=execFileSync('ffprobe',['-v','error','-rw_timeout','15000000','-show_entries','format=duration','-of','json',url],{timeout:60000,maxBuffer:1048576,stdio:['ignore','pipe','pipe']});const duration=Number(JSON.parse(raw).format?.duration);if(!(duration>500&&duration<1200))throw Error('Not a full-length expected short film: '+duration);return duration}
function frame(url,target){execFileSync('ffmpeg',['-y','-v','error','-rw_timeout','15000000','-ss','75','-i',url,'-map','0:v:0','-frames:v','1','-vf','scale=720:-2','-q:v','3',target],{timeout:75000,maxBuffer:1048576,stdio:['ignore','pipe','pipe']});if(fs.statSync(target).size<2000)throw Error('Decoded artwork was empty')}
(async()=>{
 for(const film of data.items.filter(t=>t.kind==='film')){
  const plan=plans[film.id];if(!plan)throw Error('Unreviewed film');
  const candidates=[...new Set([...plan.urls,...await indexCandidates(plan)])];film.playable=false;
  for(const url of candidates){try{
   await checkURL(url);const duration=probe(url);const dest=path.join(root,'web/artwork',film.id+'.jpg');frame(url,dest);
   Object.assign(film,{mediaUrl:url,url,format:url.includes('.m3u8')?'hls':'mp4',runtimeSec:duration,playable:true,image:'/artwork/'+film.id+'.jpg',imageSource:film.source,artworkNote:'Frame at 75 seconds from the credited Creative Commons film, resized to 720 pixels.',checkedAt:new Date().toISOString()});
   console.log('VERIFIED full film + decoded artwork:',film.id,duration.toFixed(2),url);break;
  }catch(e){console.warn('Source rejected:',film.id,url,String(e.message).split('\n')[0].slice(0,160))}}
 }
 data.builtAt=new Date().toISOString();fs.writeFileSync(file,JSON.stringify(data,null,2));fs.writeFileSync(path.join(root,'web/library-data.js'),'window.SHOWCIALS_LIBRARY='+JSON.stringify(data).replace(/</g,'\\u003c')+';\n');
 const films=data.items.filter(t=>t.kind==='film'&&t.playable),images=data.items.filter(t=>t.image);
 console.log('Validated library:',films.length,'decoded full-film sources;',images.length,'real images.');
 if(films.length<3||!films.some(t=>t.id==='sintel')||images.length<15)throw Error('Full-film/artwork acceptance incomplete');
 // Select the MSE HLS engine when native support is only optimistic. Keep Apple MMS native preference.
 let app=fs.readFileSync(path.join(root,'web/app.js'),'utf8');app=app.replace("&&window.Hls?.isSupported()&&!v.canPlayType('application/vnd.apple.mpegurl')","&&window.Hls?.isSupported()&&!(window.ManagedMediaSource&&v.canPlayType('application/vnd.apple.mpegurl'))");fs.writeFileSync(path.join(root,'web/app.js'),app);
 let server=fs.readFileSync(path.join(root,'server.js'),'utf8');server=server.replace("format:'mp4',tier:'open'","format:t.format||'mp4',tier:'open'");fs.writeFileSync(path.join(root,'server.js'),server);
})().catch(e=>{console.error(e.message);process.exit(1)});

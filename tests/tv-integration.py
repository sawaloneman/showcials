"""Actual relay + actual connector + two simulated ECP devices. Not TV hardware."""
import importlib.util,json,sys,threading,time,urllib.request
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('connector',ROOT/'web/roku-connector.py');m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
BASE='http://127.0.0.1:7802';m.DEFAULT_SERVER=BASE # TEST ONLY. Shipped connector defaults to HTTPS deployment.
def request(path,body=None,grant=''):
 h={'Content-Type':'application/json','X-Session-Grant':grant}
 with urllib.request.urlopen(urllib.request.Request(BASE+path,json.dumps(body).encode() if body is not None else None,headers=h),timeout=5)as r:return json.load(r)
class FakePlayer:
 def __init__(self,pos):self.anchor=pos;self.at=time.monotonic();self.play=True;self.episode='ep1';self.calls=[];self.lock=threading.Lock()
 def position(self):return self.anchor+(time.monotonic()-self.at if self.play else 0)
 def toggle(self):
  with self.lock:self.anchor=self.position();self.at=time.monotonic();self.play=not self.play;self.calls.append('Play')
def make_device(player):
 class Handler(BaseHTTPRequestHandler):
  def log_message(self,*a):pass
  def answer(self,b):self.send_response(200);self.send_header('Content-Type','application/xml');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
  def do_GET(self):
   if self.path=='/query/device-info':b=b'<device-info><developer-enabled>true</developer-enabled><model-name>SIMULATED</model-name><software-version>TEST</software-version></device-info>'
   elif self.path=='/query/apps':b=b'<apps><app id="12">Netflix</app></apps>'
   elif self.path=='/query/active-app':b=b'<active-app><app id="12">Netflix</app></active-app>'
   elif self.path=='/query/media-player':b=(f'<player state="{"play" if player.play else "pause"}"><plugin id="12"/><position>{player.position()*1000:.1f} ms</position><duration>300000 ms</duration><content-id>{player.episode}</content-id></player>').encode()
   else:self.send_error(404);return
   self.answer(b)
  def do_POST(self):
   if self.path=='/keypress/Play':player.toggle();self.answer(b'<ok/>')
   elif self.path=='/launch/12':self.answer(b'<ok/>')
   else:self.send_error(400)
 s=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=s.serve_forever,daemon=True).start();return s
room=request('/api/rooms/new',{})['room'];prefix='/api/rooms/'+room+'/'
a=request(prefix+'join',{'name':'Host','kind':'browser'});b=request(prefix+'join',{'name':'Guest','kind':'browser'})
def event(w,p):return request(prefix+'event',{'clientId':w['clientId'],**p},w['nativeVoiceGrant'])
def snapshot():return request(prefix+'poll?since=0&clientId='+a['clientId'],grant=a['nativeVoiceGrant'])
def until(fn,label,seconds=18):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  if fn():print('PASS',label,flush=True);return
  time.sleep(.15)
 raise AssertionError(label+' timed out')
event(a,{'type':'sync','mode':'external','provider':'netflix','contentKey':'episode1','mediaTitle':'Simulated episode','positionSec':0,'runtimeSec':300,'status':'paused'})
players=[FakePlayer(8),FakePlayer(12)];servers=[];bridges=[];threads=[]
try:
 for player,w in zip(players,[a,b]):
  server=make_device(player);servers.append(server);r=m.Roku('192.168.1.2','netflix');r.base='http://127.0.0.1:'+str(server.server_port);r.setup()
  relay=m.Relay(BASE,room,w['clientId'],'netflix');relay.join();bridge=m.Connector(r,relay);bridges.append(bridge)
  t=threading.Thread(target=bridge.run,daemon=True);t.start();threads.append(t)
 until(lambda:len(snapshot()['tv']['devices'])==2,'both Python connectors join the real relay')
 for w,bridge in zip([a,b],bridges):event(w,{'type':'tv_action','target':bridge.relay.id,'action':'confirm','contentKey':'episode1','noAds':True})
 until(lambda:all(t['armed'] for t in snapshot()['tv']['devices']),'both simulated devices return confirmed timestamps')
 event(a,{'type':'tv_action','action':'align'})
 until(lambda:snapshot()['tv']['alignment']['phase']=='running','staggered start acknowledged by both simulated devices')
 difference=abs(players[0].position()-players[1].position());assert difference<1.5,difference
 print('PASS simulated position difference after alignment:',round(difference,4),'seconds',flush=True)
 assert all(x=='Play' for p in players for x in p.calls);print('PASS only Play toggles used; no FF, RW, seek or private provider API',flush=True)
 event(b,{'type':'chat','text':'We are in the same room'})
 until(lambda:any(e.get('text')=='We are in the same room' for e in snapshot()['events']),'chat remains available during external TV session')
 event(a,{'type':'tv_action','action':'pause_all'})
 until(lambda:all(not p.play for p in players),'Pause all pauses both before revoking queued controls')
 print('PASS full integration with simulated ECP devices; NO physical Roku/provider test.',flush=True)
finally:
 for bridge in bridges:bridge.running=False
 for t in threads:t.join(timeout=4)
 for s in servers:s.shutdown()
 for w in [a,b]:
  try:request(prefix+'leave',{'clientId':w['clientId']},w['nativeVoiceGrant'])
  except Exception:pass

import importlib.util,sys,time,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('tv_connector',Path(__file__).resolve().parents[1]/'web/roku-connector.py')
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
class TestConnector(unittest.TestCase):
 def test_paramount_installed_app_match(self):
  r=m.Roku('192.168.1.3','paramount');self.assertEqual(r.service,'paramount')
  self.assertIn('paramount+',m.SERVICE_NAMES['paramount'])
 def test_units(self):
  self.assertEqual(m.seconds('6916 ms'),6.916);self.assertEqual(m.seconds('12.5 s'),12.5)
 def test_unknown_not_zero(self):
  for x in [None,'','7000','nan s','-1 s']:self.assertIsNone(m.seconds(x))
 def test_ipv4_guard(self):
  for ip in ['127.0.0.1','8.8.8.8','169.254.1.1','host.local','192.168.1.2:8060','::1']:
   with self.assertRaises(ValueError):m.Roku(ip,'netflix')
  self.assertEqual(m.Roku('192.168.1.2','netflix').base,'http://192.168.1.2:8060')
 def test_xml_entities(self):
  with self.assertRaises(m.UnsafePlayback):m.parse_xml(b'<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><x/>')
 def test_xml_limit(self):
  with self.assertRaises(m.UnsafePlayback):m.parse_xml(b' '*65537)
 def test_known_player(self):
  o=m.parse_player(b'<player state="play"><plugin id="12"/><position>6916 ms</position></player>','12',3.)
  self.assertEqual(o.position,6.916);self.assertEqual(o.state,'playing');self.assertIsNone(o.duration)
 def test_wrong_app(self):
  with self.assertRaises(m.UnsafePlayback):m.parse_player(b'<player state="play"><plugin id="13"/><position>10 s</position></player>','12',0)
 def test_live(self):
  with self.assertRaises(m.UnsafePlayback):m.parse_player(b'<player state="play"><plugin id="12"/><is_live>true</is_live></player>','12',0)
 def test_explicit_ad(self):
  with self.assertRaises(m.UnsafePlayback):m.parse_player(b'<player state="play"><plugin id="12"/><is-ad>true</is-ad></player>','12',0)
 def test_missing_position(self):
  self.assertIsNone(m.parse_player(b'<player state="pause"><plugin id="12"/></player>','12',0).position)
 def test_unrecognized_state(self):
  self.assertEqual(m.parse_player(b'<player state="mystery"><plugin id="12"/></player>','12',0).state,'unavailable')
 def test_no_blind_toggle(self):
  r=m.Roku('192.168.1.3','netflix');r.observe=lambda:m.Observation('unavailable',None,'12',None,'',0)
  r.request=lambda *a: self.fail('Blind command emitted')
  with self.assertRaises(m.UnsafePlayback):r.playing(True)
 def test_already_playing_no_toggle(self):
  r=m.Roku('192.168.1.3','netflix');r.observe=lambda:m.Observation('playing',5,'12',None,'',0)
  r.request=lambda *a:self.fail('Redundant toggle emitted')
  self.assertEqual(r.playing(True).state,'playing')
 def test_confirmed_pause_one_toggle(self):
  r=m.Roku('192.168.1.3','netflix');calls=[];observations=iter([m.Observation('playing',5,'12',None,'',0),m.Observation('paused',5,'12',None,'',0)])
  r.observe=lambda:next(observations);r.request=lambda *a:calls.append(a)
  self.assertEqual(r.playing(False).state,'paused');self.assertEqual(calls,[('/keypress/Play',True)])
 def test_redirects(self):
  with self.assertRaises(m.UnsafePlayback):m.NoRedirect().redirect_request(None,None,302,'',{},'http://8.8.8.8')
 def test_cloud_origin_fixed(self):
  with self.assertRaises(ValueError):m.Relay('https://evil.invalid','abcdefgh','a'*36,'netflix')
class TestServerCompatibility(unittest.TestCase):
 def test_old_server_blocked_before_join(self):
  original=m.read_http
  m.read_http=lambda *a,**k:b'{"ok":true,"version":"11.0.0"}'
  try:
   relay=m.Relay(m.DEFAULT_SERVER,'abcdefgh','a'*36,'netflix')
   with self.assertRaisesRegex(m.UnsafePlayback,'does not have'):relay.join()
   self.assertEqual(relay.id,'')
  finally:m.read_http=original
if __name__=='__main__':unittest.main(verbosity=2)

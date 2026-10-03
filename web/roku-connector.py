#!/usr/bin/env python3
"""SHOWCIALS local Roku developer connector (Python 3.10+, standard library only).

No password, account cookie, video, microphone, port forwarding, or DRM access.
Roku ECP developer documentation restricts third-party use; this is an opt-in
hardware-validation tool, NOT certification or a consumer integration exemption.
https://developer.roku.com/dev/docs/external-control-api
"""
from __future__ import annotations
import argparse
import ipaddress
import json
import math
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass

DEFAULT_SERVER = 'https://showcials-orbit-production.up.railway.app'
PRIVATE = tuple(ipaddress.ip_network(n) for n in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16'))
SERVICE_NAMES = {'netflix':('netflix',), 'hulu':('hulu',), 'disney':('disney plus','disney+'),
                 'prime':('prime video','amazon prime video','amazon video'), 'max':('max','hbo max'),'youtube':('youtube',),'paramount':('paramount+','paramount plus')}
class UnsafePlayback(RuntimeError):
    """Control stopped because a device observation was insufficient."""
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise UnsafePlayback('Unexpected redirect refused.')
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

def read_http(url, data=None, headers=None, timeout=3):
    req=urllib.request.Request(url,data=data,headers=headers or {},method='POST' if data is not None else 'GET')
    try:
        with OPENER.open(req,timeout=timeout) as response:
            payload=response.read(65537)
            if len(payload)>65536: raise UnsafePlayback('Device/server response exceeded size limit.')
            return payload
    except urllib.error.HTTPError as e:
        # Deliberately omit credential-bearing URLs from errors.
        raise UnsafePlayback(f'Request rejected (HTTP {e.code}).') from None

def parse_xml(payload):
    if len(payload)>65536 or b'<!DOCTYPE' in payload.upper() or b'<!ENTITY' in payload.upper():
        raise UnsafePlayback('Unsafe XML response rejected.')
    try: return ET.fromstring(payload)
    except ET.ParseError: raise UnsafePlayback('Unreadable device XML.') from None

def seconds(value):
    """No unit guessing: missing or ambiguous values stay unknown."""
    m=re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*(ms|milliseconds|s|sec|seconds)\s*',value or '',re.I)
    if not m: return None
    n=float(m[1])/(1000 if m[2].lower() in ('ms','milliseconds') else 1)
    return n if math.isfinite(n) and 0<=n<=172800 else None

@dataclass(frozen=True)
class Observation:
    state: str
    position: float|None
    app_id: str
    duration: float|None
    identity: str
    observed: float
    note: str = ''

def parse_player(payload, active_id, at):
    root=parse_xml(payload);player=root if root.tag=='player' else root.find('.//player')
    if player is None: raise UnsafePlayback('No playback observation returned.')
    plugin=player.find('plugin');plugin_id=plugin.get('id','') if plugin is not None else ''
    if not plugin_id or plugin_id!=active_id: raise UnsafePlayback('The active app and player do not match.')
    if player.get('error','false').lower()=='true': raise UnsafePlayback('Roku reports a player error.')
    state={'play':'playing','playing':'playing','pause':'paused','paused':'paused','buffer':'buffering','buffering':'buffering','stop':'stopped','close':'stopped'}.get(player.get('state','').lower(),'unavailable')
    # Only explicit ad/live markers are inspected. This is NOT a universal ad detector.
    for node in player.iter():
        tag=node.tag.lower().replace('_','-')
        if tag in ('is-ad','ad-playing','advertisement') and (node.text or '').strip().lower() in ('true','1','yes'):
            raise UnsafePlayback('An advertisement is reported. Finish the ad and confirm the episode again.')
    if (player.findtext('is_live') or player.findtext('is-live') or '').lower()=='true':
        raise UnsafePlayback('This alignment tool requires on-demand content, not live TV.')
    identity=player.findtext('content-id') or player.findtext('contentId') or ''
    return Observation(state,seconds(player.findtext('position')),plugin_id,
                       seconds(player.findtext('duration') or player.findtext('runtime')),identity,at)

class Roku:
    def __init__(self, host, service):
        try: address=ipaddress.ip_address(host)
        except ValueError: raise ValueError('Enter the Roku IPv4 address from Settings > Network > About.') from None
        if not any(address in network for network in PRIVATE):
            raise ValueError('Only a private IPv4 Roku on your LAN is allowed.')
        if service not in SERVICE_NAMES: raise ValueError('Unknown service.')
        self.base=f'http://{address}:8060';self.service=service;self.app_id=''
    def request(self,path,post=False):
        allowed=path in ('/query/apps','/query/active-app','/query/media-player','/query/device-info','/keypress/Play') or path==f'/launch/{self.app_id}' and bool(self.app_id)
        if not allowed: raise UnsafePlayback('Command not allowed.')
        return read_http(self.base+path,b'' if post else None)
    def setup(self):
        info=parse_xml(self.request('/query/device-info'))
        if (info.findtext('developer-enabled') or '').lower()!='true':
            raise UnsafePlayback('This developer validation connector requires Developer Mode. No settings will be changed for you.')
        apps=parse_xml(self.request('/query/apps'));matches=[]
        for app in apps.findall('app'):
            if (app.text or '').strip().lower() in SERVICE_NAMES[self.service] and re.fullmatch(r'[0-9]{1,12}',app.get('id','')):
                matches.append(app.get('id'))
        if len(matches)!=1: raise UnsafePlayback('Install the selected official app on Roku first; its installed app ID could not be determined uniquely.')
        self.app_id=matches[0]
        return (info.findtext('model-name') or 'Roku')+' / '+(info.findtext('software-version') or 'unknown OS')
    def observe(self):
        active=parse_xml(self.request('/query/active-app')).find('app')
        active_id=active.get('id','') if active is not None else ''
        if active_id!=self.app_id: raise UnsafePlayback('Open the selected official app. Automatic control is disarmed.')
        return parse_player(self.request('/query/media-player'),active_id,time.monotonic())
    def launch(self): self.request('/launch/'+self.app_id,True)
    def playing(self,wanted,validate=lambda o:None):
        before=self.observe();validate(before)
        if before.state not in ('playing','paused') or before.position is None: raise UnsafePlayback('No unambiguous play/pause state. No key was sent.')
        state='playing' if wanted else 'paused'
        if before.state==state:return before
        # One toggle only, followed by readback. Never blindly retry a toggle.
        self.request('/keypress/Play',True)
        end=time.monotonic()+3
        while time.monotonic()<end:
            time.sleep(.15);after=self.observe();validate(after)
            if after.state==state:return after
        raise UnsafePlayback('Play/pause was not confirmed by Roku. Control has stopped.')

class Relay:
    def __init__(self,server,room,owner,service):
        u=urllib.parse.urlsplit(server)
        local=(u.scheme=='http' and u.hostname in ('127.0.0.1','localhost') and not u.username and not u.password and u.path in ('','/') and not u.query and not u.fragment)
        if server.rstrip('/')!=DEFAULT_SERVER and not local:
            raise ValueError('Use the deployed Showcials HTTPS origin or an explicit localhost development server.')
        if not re.fullmatch(r'[a-z0-9]{8}',room) or not re.fullmatch(r'[a-f0-9]{36}',owner):
            raise ValueError('Use the exact room and pairing ID shown in the website.')
        self.base=server.rstrip('/');self.room=room;self.owner=owner;self.service=service
        self.id='';self.grant='';self.counter=0;self.clock=(0.,0.);self.best=999.;self.clock_at=0.
    def now(self): return self.clock[0]+(time.monotonic()-self.clock[1])*1000
    def request(self,action,data=None):
        start=time.monotonic();headers={'X-Session-Grant':self.grant}
        if data is not None:
            headers['Content-Type']='application/json';data={'clientId':self.id,**data};data=json.dumps(data).encode()
        response=json.loads(read_http(f'{self.base}/api/rooms/{self.room}/'+action,data,headers,timeout=3))
        end=time.monotonic();rtt=end-start
        stamp=response.get('ts')
        if isinstance(stamp,(int,float)) and (rtt<self.best or end-self.clock_at>60):
            self.best=rtt;self.clock=(stamp+rtt*500,end);self.clock_at=end
        return response
    def join(self):
        health=json.loads(read_http(self.base+'/api/health',timeout=3))
        if health.get('capabilities',{}).get('tvConnector') is not True:
            raise UnsafePlayback('This server does not have the Roku connector update. Deploy the included build or use its localhost development server.')
        w=self.request('join',{'name':'Roku connector','kind':'roku'})
        self.id=w['clientId'];self.grant=w['nativeVoiceGrant']
        try:self.event('tv_register',ownerId=self.owner,provider=self.service,consent=True)
        except Exception:
            self.leave();raise
    def event(self,kind,**fields):
        self.counter+=1
        return self.request('event',{'type':kind,'reqId':'tv'+format(self.counter,'x'),**fields})
    def snapshot(self,since=0):return self.request('poll?since='+str(int(since))+'&clientId='+self.id)
    def leave(self):
        if self.id:
            try:self.request('leave',{})
            except Exception:pass

class Connector:
    def __init__(self,device,relay):
        self.device=device;self.relay=relay;self.armed=False;self.key='';self.identity=None;self.duration=None
        self.last=None;self.last_seq=0;self.pending=None;self.alignment='';self.running=True;self.ahead_hold=False;self.timeline=None
        self.last_status=0.;self.lock=threading.RLock();self.bad_note=''
    def disarm(self,reason):
        self.armed=False;self.pending=None;self.alignment='';self.ahead_hold=False;self.bad_note=reason
    def validate(self,o):
        if not self.armed:raise UnsafePlayback('Confirm the exact episode in the paired website first.')
        if o.position is None or o.state not in ('playing','paused'):raise UnsafePlayback('Position/state unavailable or buffering. Confirm after playback recovers.')
        if self.identity and o.identity!=self.identity:raise UnsafePlayback('The episode identity changed. Confirm it again.')
        if self.duration is not None and o.duration is not None and abs(o.duration-self.duration)>2:
            raise UnsafePlayback('The runtime changed. Confirm the episode again.')
        if self.last and self.last.position is not None and o.position<self.last.position-2:
            raise UnsafePlayback('Playback jumped backwards. Confirm the episode again.')
    def report(self,op,aid,ok,o=None,message=''):
        self.relay.event('tv_result',op=op,alignmentId=aid,ok=ok,state=o.state if o else 'unavailable',positionSec=o.position if o else None,message=message)
    def handle(self,p):
        if p.get('target')!=self.relay.id:return
        if self.relay.now()-p.get('ts',0)>5000:return # no replay of old remote actions
        op=p.get('op');aid=p.get('alignmentId','')
        try:
            if op in ('cancel','disarm','disconnect'):
                self.disarm('Controls stopped. Confirm the episode to resume.')
                if op=='disconnect':self.running=False
                return
            if op=='launch':
                self.disarm('Open the episode and sign in using the official app, then confirm in Showcials.')
                self.device.launch();self.report(op,aid,True,message='App launch requested. Sign in on the TV; no subscription credentials are collected.')
                return
            if op=='confirm':
                if p.get('noAds') is not True:raise UnsafePlayback('Confirm an uninterrupted ad-free content segment.')
                o=self.device.observe()
                if o.state not in ('playing','paused') or o.position is None:raise UnsafePlayback('Start the episode once. The device must report a timestamp.')
                self.key=str(p.get('contentKey',''))[:120];self.identity=o.identity;self.duration=o.duration
                self.armed=True;self.last=o;self.bad_note='';self.pending=None;self.alignment='';return
            if not self.armed:raise UnsafePlayback('Automatic control is not armed.')
            if op=='pause':
                self.pending=None;self.ahead_hold=False;self.alignment=aid
                o=self.device.playing(False,self.validate);self.last=o
                self.report(op,aid,True,o,'Paused position confirmed by device readback.');return
            if op=='play_at':
                at=p.get('startAt');anchor=p.get('anchorPosition')
                if aid!=self.alignment or not isinstance(at,(int,float)) or not isinstance(anchor,(int,float)) or at-self.relay.now()>40000 or at<self.relay.now()-500:
                    raise UnsafePlayback('The scheduled start expired or does not belong to this alignment.')
                self.pending=(at,anchor,aid);return
        except (UnsafePlayback,OSError,ValueError) as e:
            self.disarm(str(e));self.report(op,aid,False,message=str(e))
    def scheduled(self):
        if not self.pending:return
        at,anchor,aid=self.pending
        if self.relay.now()<at:return
        self.pending=None
        try:
            if self.relay.now()-at>600:raise UnsafePlayback('Missed scheduled start; use Align TVs again.')
            o=self.device.observe();self.validate(o)
            if o.state!='paused' or abs(o.position-anchor)>.5:raise UnsafePlayback('Playback changed after the pause checkpoint.')
            o=self.device.playing(True,self.validate);self.last=o;self.report('play_at',aid,True,o,'Playback start confirmed by device readback.')
        except (UnsafePlayback,OSError,ValueError) as e:
            self.disarm(str(e));self.report('play_at',aid,False,message=str(e))
    def update_status(self):
        o=None;drift=None
        try:
            o=self.device.observe()
            if self.armed:self.validate(o)
            t=self.timeline
            if self.armed and self.alignment and not self.pending and t and t.get('mode')=='external' and t.get('contentKey')==self.key:
                target=t['positionSec']+max(0,(self.relay.now()-t['serverTime'])/1000) if t['status']=='live' else t['positionSec']
                drift=o.position-target
                # Only hold a TV that is ahead. No FF, reverse, seek or ad skipping.
                if t['status']=='live' and o.state=='playing' and drift>1.5:
                    o=self.device.playing(False,self.validate);self.ahead_hold=True
                elif self.ahead_hold and drift<=.2:
                    o=self.device.playing(True,self.validate);self.ahead_hold=False
            self.last=o
        except (UnsafePlayback,OSError,ValueError) as e:self.disarm(str(e))
        self.relay.event('tv_status',state=o.state if o else 'unavailable',positionSec=o.position if o else None,provider=self.relay.service,contentKey=self.key,
                         armed=self.armed,canRead=o is not None and o.position is not None,observedAt=self.relay.now()-(time.monotonic()-o.observed)*1000 if o else self.relay.now(),driftSec=drift,
                         note=self.bad_note or ('Readback active. Content identity is user-confirmed; ad detection is not universal.' if self.armed else 'Open the same episode, then confirm in your paired browser.'))
    def run(self):
        while self.running:
            try:
                snap=self.relay.snapshot(self.last_seq);self.timeline=snap.get('sync')
                for p in snap.get('events',[]):
                    seq=p.get('seq',0)
                    if seq<=self.last_seq:continue
                    self.last_seq=seq
                    if p.get('type')=='tv_command':self.handle(p)
                self.scheduled()
                if time.monotonic()-self.last_status>1:
                    self.update_status();self.last_status=time.monotonic()
                # Fast scheduler runs separately from status requests, which may take time.
                for _ in range(5):
                    self.scheduled();time.sleep(.08)
            except (UnsafePlayback,OSError,ValueError,KeyError,json.JSONDecodeError) as e:
                self.disarm('Connection interrupted. Reopen the connector to pair again.')
                print('STOPPED:',str(e));break
        self.relay.leave()

def main():
    a=argparse.ArgumentParser(description=__doc__)
    a.add_argument('--room');a.add_argument('--owner');a.add_argument('--service',choices=SERVICE_NAMES)
    a.add_argument('--roku');a.add_argument('--server',default=DEFAULT_SERVER)
    a.add_argument('--developer-validation',action='store_true')
    args=a.parse_args()
    print('\nSHOWCIALS - LOCAL ROKU HARDWARE VALIDATION\n')
    print('This is an experimental developer connector, not an approved Netflix/Hulu integration.')
    print('Roku ECP documentation restricts third-party use. Obtain approval before commercial distribution.')
    print('It can launch the selected official app and test play/pause using device readback.')
    print('No passwords, purchase actions, video extraction, remote microphone access or DRM changes.\n')
    if not args.developer_validation:
        print('Not started. Use --developer-validation only for a device you control and are authorized to test.')
        return 2
    if input('Type CONNECT to permit these limited local controls: ').strip()!='CONNECT':return 0
    room=(args.room or input('Room code from Showcials: ')).strip().lower()
    owner=(args.owner or input('Browser pairing ID from Showcials: ')).strip()
    service=(args.service or input('Service (netflix or hulu): ')).strip().lower()
    host=(args.roku or input('Roku IPv4 address (Settings > Network > About): ')).strip()
    relay=Relay(args.server,room,owner,service);device=Roku(host,service)
    print('Device:',device.setup());relay.join()
    print('Connected. Return to the website: Open app, choose episode, Confirm, then Align TVs.')
    print('Keep this computer on the same LAN as Roku. Press Ctrl+C to disconnect.\n')
    try:Connector(device,relay).run()
    finally:relay.leave()
    return 0
if __name__=='__main__':
    try:sys.exit(main())
    except KeyboardInterrupt:print('\nDisconnected.');sys.exit(0)
    except (OSError,ValueError,UnsafePlayback) as error:print('Not connected:',str(error));sys.exit(1)

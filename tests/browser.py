from pathlib import Path
import os
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1]
BASE=os.environ.get('BASE_URL','http://127.0.0.1:7801')
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'])
 c=b.new_context(viewport={'width':1440,'height':1050},permissions=['microphone']);a=c.new_page();errs=[];a.on('pageerror',lambda e:errs.append(str(e)))
 a.goto(BASE,wait_until='networkidle');a.screenshot(path=str(R/'orbit-desktop.png'),full_page=True);print('HOME',a.title(),a.locator('#connection').inner_text(),errs)
 a.locator('#start').click();a.locator('#dialogContent input').fill('Host');a.locator('#dialogContent .primary').click();a.wait_for_function('SC.id.length>0');a.wait_for_function('document.querySelector("video").readyState>=2');room=a.evaluate('SC.room');print('ROOM',room)
 d=b.new_context(viewport={'width':1200,'height':900},permissions=['microphone']);z=d.new_page();z.on('pageerror',lambda e:errs.append(str(e)));z.goto(BASE+'/#room='+room);z.locator('#dialogContent input').nth(1).fill('Guest');z.locator('#dialogContent .primary').click();z.wait_for_function('SC.id.length>0');z.wait_for_function('document.querySelector("video").readyState>=2');a.wait_for_function('SC.members.length===2');a.locator('#play').click();a.wait_for_timeout(3500)
 if z.locator('#enablePlayback').is_visible():z.locator('#enablePlayback').click();a.wait_for_timeout(1000)
 x=a.locator('video').evaluate('(v)=>({time:v.currentTime,paused:v.paused})');y=z.locator('video').evaluate('(v)=>({time:v.currentTime,paused:v.paused})');print('PLAY',x,y,'DRIFT',abs(x['time']-y['time']));assert not x['paused'] and not y['paused'];assert abs(x['time']-y['time'])<1.5
 a.locator('#chatText').fill('Hello, orbit!');a.locator('#chatForm button').click();z.get_by_text('Hello, orbit!',exact=True).wait_for();z.locator('#chatText').fill('<img src=x onerror=alert(1)>');z.locator('#chatForm button').click();a.get_by_text('<img src=x onerror=alert(1)>',exact=True).wait_for();assert a.locator('#messages img').count()==0;print('CHAT two-way and text-safe')
 a.locator('#forwardTen').click();a.wait_for_timeout(3000);print('SEEK',a.locator('video').evaluate('(v)=>v.currentTime'),z.locator('video').evaluate('(v)=>v.currentTime'));a.locator('#play').click();a.wait_for_timeout(1500);assert z.locator('video').evaluate('(v)=>v.paused');print('PAUSE synced')
 for page in [a,z]:
  page.locator('#talk').click();page.locator('#dialogContent input[type=checkbox]').check();page.locator('#dialogContent .primary').click();page.wait_for_function('SC.voice && SC.voice.ws.readyState===1')
 a.wait_for_function('SC.rxFrames>5 && SC.txFrames>5');z.wait_for_function('SC.rxFrames>5 && SC.txFrames>5');print('VOICE synthetic capture and bidirectional binary receive',a.evaluate('({rx:SC.rxFrames,tx:SC.txFrames})'));a.screenshot(path=str(R/'orbit-room.png'),full_page=True)
 a.locator('#talk').click();a.wait_for_function('SC.voice===null');assert a.locator('#talk').get_attribute('aria-pressed')=='false';print('VOICE stop')
 a.locator('#leave').click();a.locator('#settings').click();a.get_by_label('Larger text').check();assert a.evaluate('parseFloat(getComputedStyle(document.documentElement).fontSize)>18');a.get_by_label('Less motion',exact=False).check();a.locator('#closeDialog').click();print('ACCESSIBILITY')
 mobile=b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);m=mobile.new_page();m.goto(BASE);m.screenshot(path=str(R/'orbit-mobile.png'),full_page=True);assert m.evaluate('document.documentElement.scrollWidth<=innerWidth+1');print('MOBILE no overflow')
 assert not errs,errs;print('NO PAGE ERRORS');b.close()

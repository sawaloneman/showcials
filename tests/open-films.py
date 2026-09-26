"""Real browser playback, not test video substitution. No subscription accounts or physical Roku."""
import os,time,json,shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
BASE=os.getenv('BASE_URL','http://127.0.0.1:7802').rstrip('/')
R=Path(__file__).resolve().parents[1]
def wait(page,expr,seconds=65):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        if page.evaluate(expr): return
        page.wait_for_timeout(200)
    raise AssertionError('Timed out: '+expr+'; media='+str(page.locator('video').evaluate('(v)=>({url:v.currentSrc,time:v.currentTime,ready:v.readyState,error:v.error?.message})')))
with sync_playwright() as p:
    chrome=os.getenv('CHROMIUM_EXECUTABLE') or shutil.which('google-chrome') or shutil.which('google-chrome-stable')
    browser=p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    print('BROWSER',browser.version,'EXECUTABLE',chrome or 'Playwright Chromium',flush=True)
    ctx=browser.new_context(viewport={'width':1366,'height':960});page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(BASE,wait_until='domcontentloaded');wait(page,'!!window.OrbitLibrary')
    films=page.evaluate('SHOWCIALS_LIBRARY.items.filter(t=>t.kind==="film"&&t.playable)')
    assert len(films)>=3
    results=[]
    for f in films:
        page.locator('#browseTitles').click();page.locator('#titleSearch').fill(f['title']);page.locator('.poster-card').first.click();page.get_by_role('button',name='Preview this film',exact=True).click();page.locator('#play').click()
        wait(page,'document.querySelector("video").currentTime>2 && document.querySelector("video").readyState>=2')
        state=page.locator('video').evaluate('(v)=>({time:v.currentTime,duration:v.duration,frames:v.getVideoPlaybackQuality().totalVideoFrames,url:v.currentSrc})')
        assert state['frames']>0 and state['duration']>500,state
        page.locator('video').evaluate('(v)=>{v.currentTime=45}')
        wait(page,'document.querySelector("video").currentTime>=44 && document.querySelector("video").currentTime<52 && document.querySelector("video").readyState>=2')
        page.locator('#play').click();wait(page,'document.querySelector("video").paused')
        results.append({'title':f['title'],**state});print('PASS actual decoded film, seek, pause:',f['title'],state,flush=True)
        page.screenshot(path=str(R/('film-'+f['id']+'.png')),full_page=False);page.locator('#leave').click()
    # Select the full film through the real library-to-room UI.
    page.locator('#browseTitles').click();page.locator('#titleSearch').fill('Sintel');page.locator('.poster-card').first.click();page.get_by_role('button',name='Watch in my room',exact=True).click()
    page.locator('#dialogContent input').fill('Film host');page.locator('#dialogContent .primary').click();wait(page,'SC.id.length>0 && SC.sync?.mediaTitle==="Sintel"');room=page.evaluate('SC.room')
    ctx2=browser.new_context(viewport={'width':1280,'height':900});guest=ctx2.new_page();guest.on('pageerror',lambda e:errors.append(str(e)));guest.goto(BASE+'/#room='+room,wait_until='domcontentloaded');guest.locator('#dialogContent input').nth(1).fill('Film guest');guest.locator('#dialogContent .primary').click();wait(guest,'SC.id.length>0 && SC.sync?.mediaTitle==="Sintel"')
    page.locator('#play').click();wait(page,'document.querySelector("video").currentTime>2');guest.wait_for_timeout(1000)
    if guest.locator('#enablePlayback').is_visible():guest.locator('#enablePlayback').click()
    wait(guest,'document.querySelector("video").currentTime>2 && !document.querySelector("video").paused')
    samples=[]
    for i in range(6):
        page.wait_for_timeout(600);x=page.locator('video').evaluate('(v)=>v.currentTime');y=guest.locator('video').evaluate('(v)=>v.currentTime');samples.append(abs(x-y))
    assert max(samples)<1.5,samples
    print('PASS two-browser Sintel synchronization; six absolute differences:',samples,flush=True)
    page.locator('#chatText').fill('Full-film playback check');page.locator('#chatForm button').click();guest.get_by_text('Full-film playback check',exact=True).wait_for();page.locator('#play').click();wait(guest,'document.querySelector("video").paused');print('PASS full-film room chat and shared pause',flush=True)
    page.locator('#leave').click();guest.locator('#leave').click();assert not errors,errors
    (R/'test-results').mkdir(exist_ok=True);(R/'test-results/open-films.json').write_text(json.dumps({'films':results,'sintelDriftSamples':samples,'scope':'Real browser decoding and networking; no native device or subscription provider'},indent=2))
    browser.close()

import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';

const postUrl='https://x.com/example/status/123/video/1';
const profileUrl='https://pbs.twimg.com/profile_images/1/avatar.jpg';
const mp4Url='https://video.twimg.com/example.mp4';
const lowUrl='https://video.twimg.com/example-low.mp4';

test('実Chromeの拡張機能から遅れて表示されるX動画プレイヤーをMAINで読み取る', {timeout:30000}, async()=>{
  const temporary=await mkdtemp(join(tmpdir(),'harvest-x-video-'));
  let context,cdp;
  try {
    context=await chromium.launchPersistentContext(join(temporary,'profile'),{
      channel:'chrome',headless:true,ignoreDefaultArgs:['--disable-extensions'],
      args:['--enable-unsafe-extension-debugging','--disable-background-networking','--no-first-run','--no-default-browser-check'],
    });
    cdp=await context.browser().newBrowserCDPSession();
    const {id}=await cdp.send('Extensions.loadUnpacked',{path:resolve(process.env.HARVEST_TEST_EXTENSION_DIR ?? 'dist/extension')});
    await context.route('https://x.com/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><title>post</title><main><img src="${profileUrl}"><div role="progressbar">Loading</div></main><script>
      setTimeout(()=>{
        document.querySelector('[role=progressbar]').remove();
        const dialog=document.createElement('div');dialog.setAttribute('role','dialog');
        const permalink=document.createElement('a');permalink.href='/example/status/123';permalink.textContent='View post';
        dialog.append(permalink);
        const player=document.createElement('div');const video=document.createElement('video');video.preload='none';video.src='${lowUrl}';player.append(video);player.setAttribute('data-testid','videoPlayer');
        Object.defineProperty(player,'__reactProps$fixture',{value:{media:{variants:[{url:'${lowUrl}',content_type:'video/mp4',bitrate:200000},{url:'${mp4Url}',content_type:'video/mp4',bitrate:2000000}]}}});
        dialog.append(player);document.body.append(dialog);
      },1800);
    </script>`}));
    await context.route('https://video.twimg.com/**',route=>route.abort());
    await context.route('https://pbs.twimg.com/**',route=>route.fulfill({contentType:'image/gif',body:Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64')}));
    const post=await context.newPage();
    await post.goto(postUrl);
    const panel=await context.newPage();
    await panel.goto(`chrome-extension://${id}/app/index.html`);
    const result=await panel.evaluate(async url=>{
      const {scanTab}=await import(chrome.runtime.getURL('app/page-access.js'));
      const [tab]=await chrome.tabs.query({url});
      return await scanTab(tab.id,undefined,url);
    },postUrl);
    assert.equal(result.url,postUrl);
    assert.deepEqual(result.images,[],'プロフィール画像を解析結果から除外する');
    assert.deepEqual(result.media,[{url:mp4Url,kind:'video'}]);
  } finally {
    await cdp?.detach();await context?.close();
    await rm(temporary,{recursive:true,force:true});
  }
});

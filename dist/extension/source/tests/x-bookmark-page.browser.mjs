import {mkdtemp, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium} from 'playwright';
import {fetchXBookmarkPage} from '../dist/extension/app/content/x-bookmark-page.js';
import {scanXMedia} from '../dist/extension/app/content/x-media-scan.js';
import {parseXMedia} from '../dist/extension/core/x-media.js';

function installFixture(mode) {
      const photo=id=>({id_str:id,extended_entities:{media:[{type:'photo',media_url_https:`https://pbs.twimg.com/media/image${id}.jpg`}]}});
      const entry=id=>({entryId:`tweet-${id}`,type:'tweet',content:{id}});
      const cursor=value=>({type:'timelineCursor',content:{cursorType:'Bottom',value}});
      const state={entities:{tweets:{entities:{'1':photo('1')}}},urt:{bookmarks:{entries:[entry('1'),cursor('first')],terminatedStatus:{atBottom:false}}}};
      window.calls=0;
      const module={timelineId:mode==='likes'?'favorites-other':'bookmarks',selectEntries:s=>s.urt.bookmarks.entries,fetchBottom:()=>async(dispatch,getState)=>{
        window.calls++;
        await new Promise(r=>setTimeout(r,10));
        if(mode==='failed')throw new Error('private error');
        if(mode==='changed'){module.timelineId='favorites-other';return;}
        if(mode==='stalled')return;
        const id=String(window.calls+1);
        getState().entities.tweets.entities[id]=photo(id);
        state.urt.bookmarks.entries.splice(-1,1,entry(id),cursor('next'+id));
        if(window.calls===2)state.urt.bookmarks.terminatedStatus.atBottom=true;
      }};
      const store={getState:()=>state,dispatch:action=>action(store.dispatch,store.getState)};
      const article=document.createElement('article');article.innerHTML='<a href="/user/status/1"><time>Today</time></a>';
      article.__reactFiber$fixture={memoizedProps:{module},return:{memoizedProps:{store},...(mode==='ambiguous'?{return:{memoizedProps:{module:{timelineId:'favorites-other'}}}}:{})}};
      document.querySelector('main').append(article);

}

for (const mode of ['end','stalled','failed','timeout','changed','likes','ambiguous']) test(`スクロールせずXの続き取得を使い未読み込み画像を復元する: ${mode}`,async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();
    await page.route('https://x.com/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><main></main>'}));
    await page.goto('https://x.com/i/history');
    await page.evaluate(installFixture,mode);
    const first=await page.evaluate(scanXMedia);
    assert.equal(first.posts.length,1);
    if(mode==='timeout')await page.evaluate(()=>{const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timer(fn,ms===15000?1:ms,...args);});
    const result=await page.evaluate(fetchXBookmarkPage,'https://x.com/i/history');
    if(mode==='end'){
      assert.equal(result.status,'advanced');
      const second=await page.evaluate(scanXMedia);
      assert.equal(parseXMedia(second).media.length,2);
      assert.equal((await page.evaluate(fetchXBookmarkPage,'https://x.com/i/history')).status,'end');
      assert.equal(parseXMedia(await page.evaluate(scanXMedia)).media.length,3);
      assert.equal((await page.evaluate(fetchXBookmarkPage,'https://x.com/i/history')).status,'end');
      assert.equal(await page.evaluate(()=>window.calls),2,'終端で通信を追加しない');
    }else{
      assert.equal(result.status,['likes','ambiguous'].includes(mode)?'unavailable':mode==='timeout'?'failed':mode);
      assert.equal(await page.evaluate(()=>window.calls),['likes','ambiguous'].includes(mode)?0:1);
    }
    assert.equal(await page.evaluate(()=>scrollY),0);
    assert.equal(await page.locator('article').count(),1,'追加投稿のDOM表示なしで復元する');
  }finally{await browser.close();}
});

test('拡張機能の解析経路で未表示のページを終端まで取得する',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'harvest-bookmark-pages-'));
  let context;
  try {
    context=await chromium.launchPersistentContext(`${temp}/profile`,{channel:'chrome',headless:true,
      ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--disable-background-networking','--no-first-run']});
    const cdp=await context.browser().newBrowserCDPSession();
    const {id}=await cdp.send('Extensions.loadUnpacked',{path:resolve('dist/extension')});
    await context.route('https://x.com/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Fixture</title><main></main>'}));
    const page=await context.newPage();await page.goto('https://x.com/i/history');
    await page.evaluate(installFixture,'end');
    const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/app/index.html`);
    const result=await panel.evaluate(async()=>{
      const {scanTab}=await import(chrome.runtime.getURL('app/browser/page-access.js'));
      const [tab]=await chrome.tabs.query({url:'https://x.com/i/history'});
      return scanTab(tab.id);
    });
    assert.equal(result.images.length,3);
    assert.ok(result.images.every(url=>url.endsWith('name=orig')));
    assert.equal(result.xDiagnostics.bookmarkIncomplete,undefined);
    assert.equal(await page.evaluate(()=>window.calls),2);
    assert.equal(await page.locator('article').count(),1);
    assert.equal(await page.evaluate(()=>scrollY),0);
  }finally{await context?.close();await rm(temp,{recursive:true,force:true});}
});

import {launchBrowser} from "./support/browser.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import {scanXMedia} from '../dist/extension/app/content/x-media-scan.js';
import {parseXMedia} from '../dist/extension/core/x-media.js';

test('受信監視なしで現在の一覧だけを復元し、追加・別一覧・個別投稿を区別する', async (t) => {
  const browser = await launchBrowser(t);
  const page = await browser.newPage();
  await page.route('https://x.com/**', r => r.fulfill({contentType:'text/html',body:'<!doctype html><main></main>'}));
  await page.goto('https://x.com/i/history');
  await page.evaluate(() => {
    const entities = Object.fromEntries(['1','2','3','99'].map(id => [id,{id_str:id,full_text:'PRIVATE_TEXT',extended_entities:{media:[{type:'photo',media_url_https:`https://pbs.twimg.com/media/image${id}.jpg`}]}}]));
    const props = {entries:[{entryId:'tweet-1'},{entryId:'tweet-2'}]};
    const provider = {memoizedProps:{store:{getState:()=>({entities:{tweets:{entities}}})}}};
    const list = {memoizedProps:props,return:provider};
    const article = document.createElement('article');
    article.innerHTML='<a href="/user/status/1"><time>Today</time></a>';
    article.__reactFiber$fixture={memoizedProps:{},return:list};
    document.querySelector('main').append(article);
  });
  let snapshot = await page.evaluate(scanXMedia);
  assert.deepEqual(snapshot.posts.map(p=>p.postId),['1','2']);
  assert.equal(snapshot.bookmarkCaptureMissing,false);
  assert.equal(JSON.stringify(snapshot).includes('PRIVATE_TEXT'),false);
  assert.equal(parseXMedia(snapshot).media.length,2);
  await page.evaluate(()=>document.querySelector('article').__reactFiber$fixture.return.memoizedProps.entries.push({entryId:'tweet-3'}));
  snapshot=await page.evaluate(scanXMedia);
  assert.deepEqual(snapshot.posts.map(p=>p.postId),['1','2','3']);
  assert.equal(snapshot.posts.some(p=>p.postId==='99'),false);
  await page.evaluate(()=>{window.__harvestBookmarkMediaV1=()=>({received:true,posts:[{key:'post:99',postId:'99',observed:[],roots:[]}],limited:false});});
  assert.deepEqual((await page.evaluate(scanXMedia)).posts.map(p=>p.postId),['1','2','3'],'現在の一覧が読める場合は古い受信記録を混ぜない');
  await page.evaluate(()=>{delete window.__harvestBookmarkMediaV1;});
  assert.deepEqual((await page.evaluate(scanXMedia,'1')).posts.map(p=>p.postId),['1']);
  await page.evaluate(()=>{const props=document.querySelector('article').__reactFiber$fixture.return.memoizedProps;props.items=[{entryId:'tweet-1'},{entryId:'tweet-99'}];});
  snapshot=await page.evaluate(scanXMedia);
  assert.deepEqual(snapshot.posts.map(p=>p.postId),['1'],'曖昧な所属では一覧外を混ぜない');
  assert.equal(snapshot.bookmarkCaptureMissing,true);
  await page.evaluate(()=>{const props=document.querySelector('article').__reactFiber$fixture.return.memoizedProps;delete props.items;props.entries=[{entryId:'tweet-99'}];});
  snapshot=await page.evaluate(scanXMedia);
  assert.deepEqual(snapshot.posts.map(p=>p.postId),['1'],'画面の投稿と一致しない一覧を取り込まない');
  await page.evaluate(()=>{const provider=document.querySelector('article').__reactFiber$fixture.return.return;provider.memoizedProps.store.getState=()=>{throw new Error('unavailable');};});
  snapshot=await page.evaluate(scanXMedia);
  assert.deepEqual(snapshot.posts.map(p=>p.postId),['1'],'内部の読み取り失敗でも現在の投稿は残す');
});

for (const selector of [false,true]) test(`Xの配信コードのURT構造で現在の一覧と引用を復元する（selector=${selector}）`, async (t) => {
  const browser=await launchBrowser(t);
  const page=await browser.newPage();
  await page.route('https://x.com/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><main></main>'}));
  await page.goto('https://x.com/i/history');
  await page.evaluate(selector=>{
    const photo=id=>({id_str:id,extended_entities:{media:[{type:'photo',media_url_https:`https://pbs.twimg.com/media/image${id}.jpg`}]}});
    const state={entities:{tweets:{entities:{'1':photo('1'),'2':{...photo('2'),quoted_status_id_str:'3'},'3':photo('3'),'99':photo('99')}}},
      urt:{bookmarks:{entries:[{entryId:'tweet-1',type:'tweet',content:{id:'1'}},{entryId:'module-2',type:'timelineModule',content:{items:[{entryId:'conversation-2',type:'tweet',content:{id:'2'}}]}}]},
        'favorites-other':{entries:[{entryId:'tweet-99',type:'tweet',content:{id:'99'}}]}}};
    const module={timelineId:'bookmarks',...(selector?{selectEntries:s=>s.urt.bookmarks.entries,selectPinnedEntry:()=>undefined}:{})};
    const article=document.createElement('article');article.innerHTML='<a href="/user/status/1"><time>Today</time></a>';
    article.__reactFiber$fixture={memoizedProps:{module},return:{memoizedProps:{store:{getState:()=>state}}}};
    document.querySelector('main').append(article);
  },selector);
  const snapshot=await page.evaluate(scanXMedia);
  assert.deepEqual(snapshot.posts.map(p=>p.postId),['1','2']);
  assert.deepEqual(parseXMedia(snapshot).media.map(m=>m.url),['1','2','3'].map(id=>`https://pbs.twimg.com/media/image${id}?format=jpg&name=orig`));
  assert.equal(snapshot.bookmarkCaptureMissing,false);
  const target=await page.evaluate(scanXMedia,'2');
  assert.equal(parseXMedia(target,'2').media.length,1,'個別投稿の保存に引用先を混ぜない');
});

test('別々の解析の間にDOMとXの投稿表から先頭が消えても、同じ一覧の前後を保持する',async(t)=>{
  const browser=await launchBrowser(t);
  const page=await browser.newPage();
  await page.route('https://x.com/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><main></main>'}));
  await page.goto('https://x.com/i/history');
  await page.evaluate(()=>{
    const state={entities:{tweets:{entities:{}}},urt:{bookmarks:{entries:[]}}};
    const module={timelineId:'bookmarks',selectEntries:s=>s.urt.bookmarks.entries};
    const store={getState:()=>state};
    const article=document.createElement('article');
    article.__reactFiber$fixture={memoizedProps:{module},return:{memoizedProps:{store}}};
    document.querySelector('main').append(article);
    window.changePosts=ids=>{
      state.entities.tweets.entities=Object.fromEntries(ids.map(id=>[id,{id_str:id,extended_entities:{media:[{type:'photo',media_url_https:`https://pbs.twimg.com/media/image${id}.jpg`}]}}]));
      state.urt.bookmarks.entries=ids.map(id=>({type:'tweet',content:{id}}));
      article.innerHTML=`<a href="/user/status/${ids[0]}"><time>Today</time></a>`;
    };
    window.epoch=1;
    window.__harvestBookmarkMediaV1=()=>({received:true,epoch:window.epoch,posts:[],limited:false});
    window.changePosts(['1','2']);
  });
  assert.deepEqual((await page.evaluate(scanXMedia)).posts.map(p=>p.postId),['1','2']);
  await page.evaluate(()=>window.changePosts(['3','4']));
  let snapshot=await page.evaluate(scanXMedia);
  assert.deepEqual(snapshot.posts.map(p=>p.postId),['1','2','3','4']);
  assert.equal(parseXMedia(snapshot).media.length,4);
  await page.evaluate(()=>window.changePosts(['1','2']));
  assert.equal(parseXMedia(await page.evaluate(scanXMedia)).media.length,4,'上へ戻っても後方の画像を失わない');
  await page.evaluate(()=>{window.epoch++;window.changePosts(['5']);});
  assert.deepEqual((await page.evaluate(scanXMedia)).posts.map(p=>p.postId),['5'],'一覧再取得では旧世代を混ぜない');
  await page.evaluate(()=>{document.querySelector('article').__reactFiber$fixture.memoizedProps.module.timelineId='favorites-other';window.changePosts(['9']);});
  assert.deepEqual((await page.evaluate(scanXMedia)).posts.map(p=>p.postId),['9'],'いいねにはブックマークの履歴を混ぜない');
});

test('現在の一覧が読めても同じ世代の受信済みページを捨てない',async(t)=>{
  const browser=await launchBrowser(t);
  const page=await browser.newPage();
  await page.route('https://x.com/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><main></main>'}));
  await page.goto('https://x.com/i/history');
  await page.evaluate(()=>{
    const photo=id=>({id_str:id,extended_entities:{media:[{type:'photo',media_url_https:`https://pbs.twimg.com/media/image${id}.jpg`}]}});
    const state={entities:{tweets:{entities:{'2':photo('2')}}}};
    const article=document.createElement('article');article.innerHTML='<a href="/user/status/2"><time>Today</time></a>';
    article.__reactFiber$fixture={memoizedProps:{module:{timelineId:'bookmarks',selectEntries:()=>[{type:'tweet',content:{id:'2'}}]}},return:{memoizedProps:{store:{getState:()=>state}}}};
    document.querySelector('main').append(article);
    window.__harvestBookmarkMediaV1=()=>({received:true,epoch:1,posts:[{key:'post:1',postId:'1',observed:[],roots:[{value:photo('1'),requireIdentity:true,player:false}]}]});
  });
  const snapshot=await page.evaluate(scanXMedia);
  assert.deepEqual(snapshot.posts.map(p=>p.postId),['1','2']);
  assert.equal(parseXMedia(snapshot).media.length,2);
  await page.evaluate(()=>{
    const fiber=document.querySelector('article').__reactFiber$fixture;
    fiber.memoizedProps.module.timelineId='favorites-other';
    fiber.return.memoizedProps.store.getState=()=>({});
  });
  assert.deepEqual((await page.evaluate(scanXMedia)).posts.map(p=>p.postId),['2'],'同じURLでもいいねへ受信済みブックマークを混ぜない');
});

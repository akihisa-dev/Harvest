import {chromium} from 'playwright';
import test from 'node:test';
import {resolve} from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import assert from 'node:assert/strict';
test('Bookmark続き取得後の実script境界で一覧切替と継続機能の不在を区別する', async()=>{
const root=resolve('.'),temp=await mkdtemp('/tmp/harvest-bookmark-await-');
let context;
function fixture({ending,switchAt}){
 const photo=(id,name)=>({id_str:id,extended_entities:{media:[{type:'photo',media_url_https:`https://pbs.twimg.com/media/${name}.jpg`}]}});
 const entry=id=>({entryId:`tweet-${id}`,type:'tweet',content:{id}});
 const cursor=value=>({type:'timelineCursor',content:{cursorType:'Bottom',value}});
 const state={entities:{tweets:{entities:{'1':photo('1','B'),'2':photo('2','B2'),'99':photo('99','C')}}},urt:{bookmarks:{entries:[entry('1'),cursor('first')],terminatedStatus:{atBottom:false}}}};
 window.calls=0;
 const module={timelineId:'bookmarks',selectEntries:s=>s.urt.bookmarks.entries,fetchBottom:()=>async()=>{
  window.calls++;state.urt.bookmarks.entries=[entry('1'),entry('2'),cursor('next')];
  state.urt.bookmarks.terminatedStatus.atBottom=ending==='end'||window.calls>=2;
  if(switchAt==='inside')window.switchToLikes();
 }};
 const store={getState:()=>state,dispatch:action=>action(store.dispatch,store.getState)};
 document.querySelector('main').dataset.testid='primaryColumn';
 document.querySelector('main').__reactFiber$fixture={memoizedProps:{module},return:{memoizedProps:{store}}};
 const mount=id=>{const article=document.createElement('article');article.dataset.testid='tweet';article.innerHTML=`<a href="/user/status/${id}"><time>Today</time></a>`;article.__reactFiber$fixture={memoizedProps:{module},return:{memoizedProps:{store}}};document.querySelector('main').replaceChildren(article);};
 window.disableContinuation=()=>{module.fetchBottom=undefined;};
 window.switchToLikes=empty=>{module.timelineId='favorites-other';state.urt.bookmarks.entries=[entry('99')];
  if(empty)document.querySelector('main').replaceChildren();else mount('99');};
 mount('1');
}
try{
 context=await chromium.launchPersistentContext(temp+'/profile',{channel:'chrome',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--disable-background-networking','--no-first-run']});
 const cdp=await context.browser().newBrowserCDPSession();const {id}=await cdp.send('Extensions.loadUnpacked',{path:root+'/dist/extension'});
 await context.route('**/*',r=>r.request().url().startsWith('chrome-extension:')?r.continue():r.request().resourceType()==='document'?r.fulfill({contentType:'text/html',body:'<!doctype html><title>Boundary fixture</title><main></main>'}):r.abort());
 const target=await context.newPage(),panel=await context.newPage();
 for(const ending of ['advanced','end'])for(const switchAt of ['none','inside','after','after-empty','disabled']){
  await target.goto('https://fixture.test/A');await target.evaluate(()=>{document.querySelector('main').innerHTML='<img data-src="https://fixture.test/A.png">';});
  await panel.goto(`chrome-extension://${id}/app/index.html`);
  await panel.evaluate(async()=>{
   const query=chrome.tabs.query.bind(chrome.tabs),[target]=await query({url:'https://fixture.test/A'});
   chrome.tabs.query=async q=>q.active?[await chrome.tabs.get(target.id)]:query(q);
   const {ImageCollection}=await import(chrome.runtime.getURL('core/image-collection.js'));
   const replace=ImageCollection.prototype.replace;window.publications=[];
   ImageCollection.prototype.replace=function(...args){window.collection=this;window.publications.push(args);return replace.apply(this,args);};
  });
  await panel.locator('#scan').click();await panel.waitForFunction(()=>document.querySelector('#scan').dataset.scanning==='false');
  await panel.evaluate(()=>{window.previous=window.collection.items;});
  await target.goto('https://x.com/i/history');await target.evaluate(fixture,{ending,switchAt});
  await panel.evaluate(async switchAt=>{
   const {parseXMedia}=await import(chrome.runtime.getURL('core/x-media.js'));
   const execute=chrome.scripting.executeScript.bind(chrome.scripting);window.trace=[];let reads=0;
   chrome.scripting.executeScript=async request=>{
    const name=request.func.name;window.trace.push({event:'request',name});
    if(name==='scanXMedia'&&++reads===2&&['after','after-empty','disabled'].includes(switchAt)){
     window.waiting=true;await new Promise(resolve=>window.release=resolve);
    }
    const response=await execute(request);
    if(name==='fetchXBookmarkPage')window.trace.push({event:'response',name,result:response[0].result});
    if(name==='scanXMedia'){const snapshot=response[0].result;window.trace.push({event:'response',name,bookmarkContinuation:snapshot.bookmarkContinuation,bookmarkList:snapshot.bookmarkList,postKeys:snapshot.posts.map(p=>p.key),urls:parseXMedia(snapshot).media.map(m=>m.url),documentId:response[0].documentId});}
    return response;
   };
  },switchAt);
  await panel.locator('#scan').click();
  let beforeSwitch;
  if(['after','after-empty','disabled'].includes(switchAt)){
   await panel.waitForFunction(()=>window.waiting);
   beforeSwitch=await panel.evaluate(()=>({same:window.collection.items===window.previous,publications:window.publications.length,trace:window.trace,scanning:document.querySelector('#scan').dataset.scanning}));
   await target.evaluate(mode=>mode.startsWith('after')?window.switchToLikes(mode==='after-empty'):window.disableContinuation(),switchAt);await panel.evaluate(()=>window.release());
  }
  await panel.waitForFunction(()=>document.querySelector('#scan').dataset.scanning==='false');await panel.waitForTimeout(500);
  const final=await panel.evaluate(()=>({same:window.collection.items===window.previous,urls:window.collection.items.map(i=>i.url),publications:window.publications,rows:[...document.querySelectorAll('[data-focus-url]')].map(r=>r.dataset.focusUrl),status:document.querySelector('#status').textContent,statusState:document.querySelector('#status').dataset.state,overlay:!document.querySelector('#scan-overlay').hidden,trace:window.trace}));
  assert.deepEqual(final.rows,final.urls);assert.equal(final.urls.some(u=>u.includes('/C?')),false);
  if(switchAt==='inside'){assert.equal(final.same,true);assert.equal(final.publications.length,1);assert.match(final.status,/ページが移動/);}
  else if(switchAt.startsWith('after')){
   assert.equal(beforeSwitch.same,true);assert.equal(beforeSwitch.publications,1);
   assert.equal(beforeSwitch.trace.findLast(t=>t.name==='fetchXBookmarkPage').result.status,ending);
   assert.equal(final.same,true);assert.equal(final.publications.length,1);assert.deepEqual(final.urls,['https://fixture.test/A.png']);assert.match(final.status,/ページが移動/);assert.equal(final.statusState,'error');
   assert.equal(final.trace.findLast(t=>t.name==='scanXMedia'&&t.event==='response').bookmarkContinuation,switchAt==='after-empty'?undefined:false);
   assert.deepEqual(final.trace.findLast(t=>t.name==='scanXMedia'&&t.event==='response').urls,switchAt==='after-empty'?[]:['https://pbs.twimg.com/media/C?format=jpg&name=orig']);
   assert.equal(final.trace.findLast(t=>t.name==='scanXMedia'&&t.event==='response').bookmarkList,'other');
  }else{assert.equal(final.same,false,`${ending}/${switchAt}: ${JSON.stringify(final)}`);assert.equal(final.urls.length,2);
   if(switchAt==='disabled'&&ending==='advanced')assert.match(final.status,/続きを取得できません/);else assert.equal(final.status,'');
   if(switchAt==='disabled'){const last=final.trace.findLast(t=>t.name==='scanXMedia'&&t.event==='response');assert.equal(last.bookmarkList,'bookmarks');assert.equal(last.bookmarkContinuation,false);}
  }

 }
}finally{await context?.close();await rm(temp,{recursive:true,force:true});}
});

import {chromium} from 'playwright';
import test from 'node:test';
import {resolve} from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import assert from 'node:assert/strict';
test('Bookmarkの最終確認前の同URL一覧切替を実Chromeで拒否する',async()=>{
const root=resolve('.'),temp=await mkdtemp('/tmp/harvest-bookmark-final-');
let context;
function fixture(){
 const photo=(id,name)=>({id_str:id,extended_entities:{media:[{type:'photo',media_url_https:`https://pbs.twimg.com/media/${name}.jpg`}]}});
 const entry=id=>({entryId:`tweet-${id}`,type:'tweet',content:{id}});
 const state={entities:{tweets:{entities:{'1':photo('1','B'),'99':photo('99','C')}}},urt:{bookmarks:{entries:[entry('1'),{type:'timelineCursor',content:{cursorType:'Bottom',value:'first'}}],terminatedStatus:{atBottom:false}}}};
 const module={timelineId:'bookmarks',selectEntries:s=>s.urt.bookmarks.entries,fetchBottom:()=>async()=>{window.calls++;state.urt.bookmarks.terminatedStatus.atBottom=true;}};
 const store={getState:()=>state,dispatch:action=>action(store.dispatch,store.getState)};
 const mount=id=>{const article=document.createElement('article');article.dataset.testid='tweet';article.innerHTML=`<a href="/user/status/${id}"><time>Today</time></a>`;article.__reactFiber$fixture={memoizedProps:{module},return:{memoizedProps:{store}}};document.querySelector('main').replaceChildren(article);};
 window.calls=0;window.currentList='bookmarks';
 window.switchToLikes=()=>{module.timelineId='favorites-other';state.urt.bookmarks.entries=[entry('99')];mount('99');window.currentList='likes';};
 mount('1');
}
try{
 context=await chromium.launchPersistentContext(temp+'/profile',{channel:'chrome',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--disable-background-networking','--no-first-run']});
 const cdp=await context.browser().newBrowserCDPSession();const {id}=await cdp.send('Extensions.loadUnpacked',{path:root+'/dist/extension'});
 await context.route('**/*',r=>r.request().url().startsWith('chrome-extension:')?r.continue():r.request().resourceType()==='document'?r.fulfill({contentType:'text/html',body:'<!doctype html><title>Final boundary fixture</title><main></main>'}):r.abort());
 const target=await context.newPage(),panel=await context.newPage();
 for(const boundary of ['next-scan-injection','tabs-get','location-injection'])for(const changed of [false,true]){
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
  await target.goto('https://x.com/i/history');await target.evaluate(fixture);
  await panel.evaluate(async boundary=>{
   const {parseXMedia}=await import(chrome.runtime.getURL('core/x-media.js'));
   const execute=chrome.scripting.executeScript.bind(chrome.scripting),get=chrome.tabs.get.bind(chrome.tabs);
   window.trace=[];window.finalMediaReceived=false;let reads=0,gated=false;
   const gate=async name=>{if(gated)return;gated=true;window.trace.push({event:'gate',name});window.waiting=true;await new Promise(resolve=>window.release=resolve);};
   chrome.tabs.get=async id=>{
    if(window.finalMediaReceived){window.trace.push({event:'request',name:'tabs.get'});if(boundary==='tabs-get')await gate('tabs.get');}
    const response=await get(id);
    if(window.finalMediaReceived)window.trace.push({event:'response',name:'tabs.get',url:response.url,status:response.status});
    return response;
   };
   chrome.scripting.executeScript=async request=>{
    const name=request.args?.[2]===true?'finalBookmarkIdentity':request.func.name;window.trace.push({event:'request',name});
    if(name==='scanXMedia'&&++reads===2&&boundary==='next-scan-injection')await gate(name);
    if(window.finalMediaReceived&&name==='finalBookmarkIdentity'&&boundary==='location-injection')await gate('location.href');
    const response=await execute(request);
    if(name==='fetchXBookmarkPage')window.trace.push({event:'response',name,result:response[0].result});
    if(name==='scanXMedia'){
     const snapshot=response[0].result;
     window.trace.push({event:'response',name,bookmarkList:snapshot.bookmarkList,bookmarkContinuation:snapshot.bookmarkContinuation,postKeys:snapshot.posts.map(p=>p.key),urls:parseXMedia(snapshot).media.map(m=>m.url),documentId:response[0].documentId});
     if(reads===2)window.finalMediaReceived=true;
    }
    if(name==='finalBookmarkIdentity')window.trace.push({event:'response',name,result:response[0].result,documentId:response[0].documentId});
    return response;
   };
  },boundary);
  await panel.locator('#scan').click();await panel.waitForFunction(()=>window.waiting);
  const atGate=await panel.evaluate(()=>({same:window.collection.items===window.previous,publications:window.publications.length,trace:window.trace,scanning:document.querySelector('#scan').dataset.scanning}));
  if(changed)await target.evaluate(()=>window.switchToLikes());await panel.evaluate(()=>window.release());
  await panel.waitForFunction(()=>document.querySelector('#scan').dataset.scanning==='false');await panel.waitForTimeout(500);
  const final=await panel.evaluate(()=>({same:window.collection.items===window.previous,urls:window.collection.items.map(i=>i.url),publications:window.publications,rows:[...document.querySelectorAll('[data-focus-url]')].map(r=>r.dataset.focusUrl),status:document.querySelector('#status').textContent,statusState:document.querySelector('#status').dataset.state,overlay:!document.querySelector('#scan-overlay').hidden,trace:window.trace}));
  const source=await target.evaluate(()=>({url:location.href,list:window.currentList,calls:window.calls}));
  assert.equal(atGate.same,true);assert.equal(atGate.publications,1);assert.equal(atGate.scanning,'true');assert.equal(source.calls,1);assert.deepEqual(final.rows,final.urls);
  if(changed){
   assert.equal(final.same,true);assert.equal(final.publications.length,1);assert.deepEqual(final.urls,['https://fixture.test/A.png']);assert.match(final.status,/ページが移動/);assert.equal(final.statusState,'error');
   if(boundary==='next-scan-injection')assert.equal(final.trace.findLast(t=>t.event==='response'&&t.name==='scanXMedia').bookmarkList,'other');
   else assert.equal(final.trace.findLast(t=>t.event==='response'&&t.name==='finalBookmarkIdentity').result.bookmarkList,'other');
  }else{
   assert.equal(final.same,false);assert.equal(final.publications.length,2);assert.deepEqual(final.urls,['https://pbs.twimg.com/media/B?format=jpg&name=orig']);assert.equal(final.status,'');
   assert.equal(final.trace.findLast(t=>t.event==='response'&&t.name==='scanXMedia').bookmarkList,'bookmarks');
   const location=final.trace.findLast(t=>t.event==='response'&&t.name==='finalBookmarkIdentity');assert.equal(location.result.url,'https://x.com/i/history');assert.equal(location.result.bookmarkList,'bookmarks');assert.deepEqual(location.result.posts,[]);
   const scan=final.trace.findLast(t=>t.event==='response'&&t.name==='scanXMedia');assert.equal(location.documentId,scan.documentId);
  }

 }
}finally{await context?.close();await rm(temp,{recursive:true,force:true});}
});

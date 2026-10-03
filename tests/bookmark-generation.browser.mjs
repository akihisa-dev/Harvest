import {temporaryDirectory, launchExtensionContext} from './support/browser.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
test('実Chromeの受信世代変更では旧投稿を再混入せず再解析を案内する', async t => {
const temp=await temporaryDirectory(t,'/tmp/harvest-generation-chrome-');let context;
const response=(ids,clear=false)=>({data:{bookmark_timeline_v2:{timeline:{instructions:[...(clear?[{type:'TimelineClearCache'}]:[]),{type:'TimelineAddEntries',entries:ids.map(id=>({entryId:'tweet-'+id,content:{itemContent:{tweet_results:{result:{rest_id:id,legacy:{extended_entities:{media:[{type:'photo',media_url_https:`https://pbs.twimg.com/media/image${id}.jpg`}]}}}}}}}))}]}}}});
try{
 context=await launchExtensionContext(t,temp+'/profile');
 const cdp=await context.browser().newBrowserCDPSession();const {id}=await cdp.send('Extensions.loadUnpacked',{path:process.cwd()+'/dist/extension'});
 let nextResponse=response(['1']), currentMode='';
 await context.route('**/*',r=>{const url=r.request().url();if(url.startsWith('chrome-extension:'))return r.continue();if(url.includes('/graphql/fixture/Bookmarks')){return r.fulfill({contentType:'application/json',body:JSON.stringify(url.includes('final=1')?response(['9'],currentMode==='clear-final'):nextResponse)});}return r.request().resourceType()==='document'?r.fulfill({contentType:'text/html',body:'<!doctype html><main></main>'}):r.abort();});
 const page=await context.newPage(),panel=await context.newPage();await panel.goto(`chrome-extension://${id}/app/index.html`);
 for(const mode of ['append','head','clear','head-final','clear-final']){
  currentMode=mode;nextResponse=response(['1']);await page.goto('https://x.com/i/history');
  await page.evaluate(async()=>{await(await fetch('/i/api/graphql/fixture/Bookmarks?variables=%7B%7D')).json();});await page.waitForFunction(()=>window.__harvestBookmarkMediaV1().posts.some(p=>p.postId==='1'));
  await page.evaluate(mode=>{
   const photo=id=>({id_str:id,extended_entities:{media:[{type:'photo',media_url_https:`https://pbs.twimg.com/media/image${id}.jpg`}]}});
   const entry=id=>({entryId:'tweet-'+id,type:'tweet',content:{id}}),cursor={type:'timelineCursor',content:{cursorType:'Bottom',value:'first'}};
   const state={entities:{tweets:{entities:{'1':photo('1'),'9':photo('9')}}},urt:{bookmarks:{entries:[entry('1'),cursor],terminatedStatus:{atBottom:false}}}};
   const mount=id=>{const a=document.createElement('article');a.dataset.testid='tweet';const link=document.createElement('a');link.href='/user/status/'+id;link.append(document.createElement('time'));a.append(link);a.__reactFiber$fixture={memoizedProps:{module},return:{memoizedProps:{store}}};document.querySelector('main').replaceChildren(a);};
   const module={timelineId:'bookmarks',selectEntries:s=>s.urt.bookmarks.entries,fetchBottom:()=>async()=>{
    window.calls++;window.beforeReset={epoch:window.__harvestBookmarkMediaV1().epoch,memory:window.__harvestBookmarkScanMemoryV1?.posts.map(p=>p.postId)};
    const variables=mode==='head'?{}:{cursor:'next'};await(await fetch('/i/api/graphql/fixture/Bookmarks?variables='+encodeURIComponent(JSON.stringify(variables)))).json();
    await new Promise((resolve,reject)=>{let count=0;const check=()=>window.__harvestBookmarkMediaV1().posts.some(p=>p.postId==='9')?resolve():++count>200?reject(Error('capture timeout')):setTimeout(check,10);check();});
    state.urt.bookmarks.entries=(mode==='append'||mode.endsWith('-final')?['1','9']:['9']).map(entry);state.urt.bookmarks.terminatedStatus.atBottom=true;mount('9');
    window.afterReset={epoch:window.__harvestBookmarkMediaV1().epoch,captured:window.__harvestBookmarkMediaV1().posts.map(p=>p.postId),memory:window.__harvestBookmarkScanMemoryV1?.posts.map(p=>p.postId),selectEntries:module.selectEntries(state).map(e=>e.content.id),sameModule:module===window.initialModule};
   }};const store={getState:()=>state,dispatch:action=>action(store.dispatch,store.getState)};window.initialModule=module;window.calls=0;mount('1');
  },mode);
  nextResponse=response(['9'],mode==='clear');
  const result=await panel.evaluate(async mode=>{
   const execute=chrome.scripting.executeScript.bind(chrome.scripting);window.trace=[];
   chrome.scripting.executeScript=async request=>{
    if(mode.endsWith('-final')&&request.args?.[2]===true){
     await execute({target:request.target,world:'MAIN',func:async clear=>{
      const before=window.__harvestBookmarkMediaV1().epoch;
      await(await fetch('/i/api/graphql/fixture/Bookmarks?final=1&variables='+encodeURIComponent(JSON.stringify(clear?{cursor:'last'}:{})))).json();
      await new Promise((resolve,reject)=>{let count=0;const check=()=>window.__harvestBookmarkMediaV1().epoch>before?resolve():++count>200?reject(Error('generation timeout')):setTimeout(check,10);check();});
     },args:[mode==='clear-final']});
    }
    const answer=await execute(request);if(request.func.name==='scanXMedia'&&request.args?.[2]!==true)window.trace.push({posts:answer[0].result.posts.map(p=>p.postId),documentId:answer[0].documentId});return answer;};
   try{const {scanTab}=await import(chrome.runtime.getURL('app/browser/page-access.js'));const [tab]=await chrome.tabs.query({url:'https://x.com/i/history'});try{return {scan:await scanTab(tab.id),trace:window.trace};}catch(error){return {error:error.message,trace:window.trace};}}finally{chrome.scripting.executeScript=execute;}
  },mode);
  const source=await page.evaluate(()=>({url:location.href,calls:window.calls,before:window.beforeReset,after:window.afterReset,memory:window.__harvestBookmarkScanMemoryV1?.posts.map(p=>p.postId)}));
  assert.equal(source.calls,1);assert.deepEqual(result.trace[0].posts,['1']);assert.deepEqual(result.trace[1].posts,mode==='append'||mode.endsWith('-final')?['1','9']:['9']);assert.equal(result.trace[0].documentId,result.trace[1].documentId);assert.equal(source.after.sameModule,true);
  if(mode==='append') assert.deepEqual(result.scan.images,['1','9'].map(id=>`https://pbs.twimg.com/media/image${id}?format=jpg&name=orig`));
  else {assert.equal(result.scan,undefined);assert.match(result.error,/取得状態/);}
  assert.deepEqual(await page.evaluate(()=>Object.keys(window.__harvestBookmarkMediaV1(true))),['epoch']);
  if(['head','clear'].includes(mode))assert.ok(source.after.epoch>source.before.epoch);

 }

}finally{await context?.close();}
});

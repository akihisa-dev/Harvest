import {launchBrowser, temporaryDirectory, launchExtensionContext} from "./support/browser.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import {resolve} from 'node:path';
import {scanXMedia} from '../dist/extension/app/content/x-media-scan.js';
import {parseXMedia} from '../dist/extension/core/x-media.js';
const urls=ids=>ids.map(id=>`https://pbs.twimg.com/media/image${id}?format=jpg&name=orig`);
function fixture(captured){
 const photo=id=>({id_str:id,extended_entities:{media:[{type:'photo',media_url_https:`https://pbs.twimg.com/media/image${id}.jpg`}]}});
 const state={entities:{tweets:{entities:{}}},urt:{bookmarks:{entries:[],terminatedStatus:{atBottom:false}}}};
 const module={timelineId:'bookmarks',selectEntries:s=>s.urt.bookmarks.entries};const store={getState:()=>state,dispatch:action=>action(store.dispatch,store.getState)};
 const article=document.createElement('article');article.__reactFiber$fixture={memoizedProps:{module},return:{memoizedProps:{store}}};document.querySelector('main').append(article);
 window.changePosts=ids=>{window.ids=ids;state.entities.tweets.entities=Object.fromEntries(ids.map(id=>[id,photo(id)]));state.urt.bookmarks.entries=ids.map(id=>({type:'tweet',content:{id}}));const a=document.createElement('a');a.href='/user/status/'+ids[0];a.append(document.createElement('time'));article.replaceChildren(a);};
 if(captured!==undefined)window.__harvestBookmarkMediaV1=()=>({received:true,epoch:1,posts:captured?window.ids.map(id=>({key:'post:'+id,postId:id,observed:[],roots:[{value:photo(id),requireIdentity:true,player:false}]})):[],limited:false});
 window.beginContinuation=()=>{state.urt.bookmarks.entries.push({type:'timelineCursor',content:{cursorType:'Bottom',value:'first'}});state.urt.bookmarks.terminatedStatus.atBottom=false;module.fetchBottom=()=>async()=>{window.changePosts(['1','2','3','4']);state.urt.bookmarks.terminatedStatus.atBottom=true;};};
}
for(const captured of [false,true])test(`保持済み投稿を欠落させず現在の一覧順を優先する: captured=${captured}`,async(t)=>{
 const browser=await launchBrowser(t);
const page=await browser.newPage();await page.route('**/*',r=>r.request().resourceType()==='document'?r.fulfill({contentType:'text/html',body:'<!doctype html><main></main>'}):r.abort());await page.goto('https://x.com/i/history');await page.evaluate(fixture,captured);
for(const [current,expected] of [[['3','4'],['3','4']],[['1','2','3','4'],['1','2','3','4']],[['2','3'],['1','2','3','4']],[['1','2'],['1','2','3','4']],[['3','4'],['1','2','3','4']]]){
 await page.evaluate(ids=>window.changePosts(ids),current);const snapshot=await page.evaluate(scanXMedia);
 assert.deepEqual(snapshot.posts.map(p=>p.postId),expected);assert.deepEqual(parseXMedia(snapshot).media.map(m=>m.url),urls(expected));
}
});
test('実拡張機能の再解析と続き取得でも前方の投稿を一覧順へ戻す',async(t)=>{
 const temp=await temporaryDirectory(t, '/tmp/harvest-bookmark-order-'); const context = await launchExtensionContext(t, temp);
const cdp=await context.browser().newBrowserCDPSession();const {id}=await cdp.send('Extensions.loadUnpacked',{path:resolve('dist/extension')});
await context.route('**/*',r=>r.request().url().startsWith('chrome-extension:')?r.continue():r.request().resourceType()==='document'?r.fulfill({contentType:'text/html',body:'<!doctype html><main></main>'}):r.abort());
const page=await context.newPage(),panel=await context.newPage();await page.goto('https://x.com/i/history');await page.evaluate(fixture);await panel.goto(`chrome-extension://${id}/app/index.html`);
const scan=()=>panel.evaluate(async()=>{const {scanTab}=await import(chrome.runtime.getURL('app/browser/page-access.js'));const [tab]=await chrome.tabs.query({url:'https://x.com/i/history'});return scanTab(tab.id);});
await page.evaluate(()=>window.changePosts(['3','4']));assert.deepEqual((await scan()).images,urls(['3','4']));
await page.evaluate(()=>window.beginContinuation());let result=await scan();assert.deepEqual(result.images,urls(['1','2','3','4']));assert.deepEqual(result.media.map(m=>m.url),result.images);assert.equal(result.xDiagnostics.bookmarkIncomplete,undefined);
await page.evaluate(()=>window.changePosts(['1','2']));result=await scan();assert.deepEqual(result.images,urls(['1','2','3','4']));
});

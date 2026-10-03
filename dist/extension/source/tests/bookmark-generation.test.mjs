import test from 'node:test';
import assert from 'node:assert/strict';
import {ImageCollection} from '../dist/extension/core/image-collection.js';
import {createScanSessionController} from '../dist/extension/app/panel/scan-session-controller.js';

for(const boundary of ['end','failed','stopped','retry','final'])for(const changed of [false,true])test(`Bookmark世代の変更を公開前に確認する: ${boundary}/${changed}`,async t=>{
 const oldChrome=globalThis.chrome,url='https://x.com/i/history',collection=new ImageCollection(),statuses=[];let controller,reads=0,fetched=false;
 collection.replace(['https://fixture.test/A1.png','https://fixture.test/A2.png'],'https://fixture.test/A');collection.setSelected(collection.items[0].url,false);collection.applyVisibleOrder(collection.items,[...collection.items].reverse());const old=collection.items,selected=old.map(i=>i.selected);
 const post=id=>({key:'post:'+id,postId:id,observed:[],roots:[{requireIdentity:false,player:false,value:{rest_id:id,extended_entities:{media:[{type:'photo',media_url_https:`https://pbs.twimg.com/media/image${id}.jpg`}]}}}]});
 globalThis.chrome={tabs:{query:async()=>[{id:7,url}],get:async()=>({url,status:'complete'}),onRemoved:{addListener(){},removeListener(){}}},scripting:{executeScript:async({func,args})=>{
  if(func.name==='scanXMedia'){
   const identity=args?.[2]===true;if(!identity)reads++;
   const moved=changed&&(boundary==='final'?identity:reads>=2);
   const posts=identity?[]:[post(reads>=2?'9':'1')];
   if(boundary==='retry'&&reads===1)posts[0].observed=[{kind:'video'}];
   return [{documentId:'doc',result:{url,limited:false,posts,bookmarkList:'bookmarks',bookmarkEpoch:moved?2:1,bookmarkContinuation:!identity&&!fetched&&!['retry','final'].includes(boundary)}}];
  }
  if(func.name==='fetchXBookmarkPage'){fetched=true;if(boundary==='stopped')controller.stop();return [{documentId:'doc',result:{status:boundary==='failed'?'failed':'end'}}];}
  return [{documentId:'doc',result:{url,title:'Bookmarks',images:[]}}];
 }}};t.after(()=>globalThis.chrome=oldChrome);
 controller=createScanSessionController({collection,getEnteredUrl:()=>'',getCollectionSession:()=>null,clearAnalyzedUrl(){},markAnalyzedUrl(){},isBusy:()=>false,isDisposed:()=>false,onHideSourceInput(){},onShowSourceInput(){},onBusyChange(){},onStatus:(...args)=>statuses.push(args),onResults(){}});
 await controller.start();assert.equal(controller.isRunning,false);
 if(changed){assert.equal(collection.items,old);assert.deepEqual(collection.items.map(i=>i.selected),selected);assert.match(statuses.at(-1)[0],/取得状態/);assert.equal(statuses.at(-1)[1],'error');}
 else if(boundary==='retry')assert.deepEqual(collection.items.map(i=>i.url),['https://pbs.twimg.com/media/image1?format=jpg&name=orig']);
 else{const ids=boundary==='final'?['1']:['1','9'];assert.deepEqual(collection.items.map(i=>i.url),ids.map(id=>`https://pbs.twimg.com/media/image${id}?format=jpg&name=orig`));}
});

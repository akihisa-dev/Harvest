import assert from "node:assert/strict";
import test from "node:test";
import {createSplitExportSession} from "../dist/extension/app/panel/split-export-session.js";
import {createExportLifecycle} from "../dist/extension/app/panel/export-lifecycle.js";

const image = name => ({url:`https://example.test/${name}.png`,sourcePage:"https://example.test/",selected:true});
function fixture() {
  let selected=[image("a"),image("b")],busy=false;
  const calls=[];
  const controller={pending:null,isRunning:false,progress:"",task:async()=>{},
    clear(){calls.push("clear");this.pending=null;},
    abort(){calls.push("abort");},
    discardIfSelectionChanged(items){
      if (!this.pending || this.pending.selected.length===items.length&&this.pending.selected.every((item,index)=>item===items[index])) return false;
      this.clear();return true;
    },
    async export(snapshot){calls.push(snapshot);this.isRunning=true;busy=true;try{await this.task();}finally{this.isRunning=false;busy=false;}},
  };
  const session=createSplitExportSession({imageFormat:"pdf",videoFormat:"mp4",includeSourcePage:false,
    getSelectedItems:()=>selected,getController:()=>controller,isBusy:()=>busy});
  return {session,controller,calls,get selected(){return selected;},set selected(value){selected=value;}};
}
const pending = f => ({selected:[...f.selected],imageFormat:f.session.format,videoFormat:f.session.videoFormat,
  includeSourcePage:f.session.includeSourcePage,resolvedImageFormat:f.session.resolvedImageFormat,prepared:new Map(),failed:new Map([[f.selected[0],"failed"]])});

test("現行sessionの状態参照は準備を変更せず、選択変更イベントで破棄する",()=>{
  const f=fixture(),work=pending(f);f.controller.pending=work;f.selected=[...f.selected].reverse();
  for(let i=0;i<3;i++){assert.equal(f.session.state.view.phase,"retry-required");assert.equal(f.session.state.view.pending,work);}
  assert.deepEqual(f.calls,[]);assert.equal(f.session.selectionChanged(),true);assert.equal(f.controller.pending,null);assert.equal(f.session.state.view.phase,"ready");
});
test("同一設定は再試行を保持し、画像・動画・出典設定の変更は準備を解放する",()=>{
  const f=fixture();
  for(const [method,value] of [["setFormat","png"],["setVideoFormat","original"],["setIncludeSourcePage",true]]){
    const work=pending(f);f.controller.pending=work;
    f.session.setFormat(f.session.format);f.session.setVideoFormat(f.session.videoFormat);f.session.setIncludeSourcePage(f.session.includeSourcePage);
    assert.equal(f.session.selectionChanged(),false);assert.equal(f.controller.pending,work);
    f.session[method](value);assert.equal(f.controller.pending,null);
  }
});
test("現行保存のスナップショットは全媒体と順序を固定し、重複開始を拒否する",async()=>{
  const f=fixture(),video={...image("movie"),kind:"video"};f.selected.push(video);
  let finish;f.controller.task=async()=>{await new Promise(resolve=>finish=resolve);f.session.complete();};
  const original=[...f.selected],execution=f.session.start();assert.equal(f.session.state.view.phase,"running");
  assert.deepEqual(f.calls[0].selected,original);assert.equal(f.calls[0].imageFormat,"pdf");assert.equal(f.calls[0].videoFormat,"mp4");
  await f.session.start();assert.equal(f.calls.length,1);
  f.selected.reverse();f.session.selectionChanged();finish();await execution;
  assert.deepEqual(f.calls[0].selected,original);assert.equal(f.session.state.view.phase,"ready");
  f.selected=original;assert.equal(f.session.state.view.phase,"ready","無効化した完了を復活させない");
});
test("明示完了のみ保存済みになり、空対象では開始しない",async()=>{
  const f=fixture();f.session.complete();assert.equal(f.session.state.view.phase,"ready");
  await f.session.start();assert.equal(f.session.state.view.phase,"ready");
  f.controller.task=async()=>f.session.complete();await f.session.start();assert.equal(f.session.state.view.phase,"saved");
  f.session.setIncludeSourcePage(true);assert.equal(f.session.state.view.phase,"ready");
  f.selected=[];const count=f.calls.length;await f.session.start();assert.equal(f.calls.length,count);assert.equal(f.session.state.view.phase,"empty");
});
for(const action of ["clear","invalidateCompletion","abort"]){
  test(`${action}後の遅い完了通知を拒否し次の保存は受け付ける`,async()=>{
    const f=fixture();let finish;f.controller.task=async()=>{await new Promise(resolve=>finish=resolve);f.session.complete();};
    const execution=f.session.start();f.session[action]();finish();await execution;assert.equal(f.session.state.view.phase,"ready");
    if(action==="abort")assert.equal(f.calls.at(-1),"abort");
    f.controller.task=async()=>f.session.complete();await f.session.start();assert.equal(f.session.state.view.phase,"saved");
  });
}
for(const first of ["pdf","png"]){
  test(`${first}開始後に形式変更しても開始したcontrollerが中止を所有する`,async()=>{
    const f=fixture();f.session.setFormat(first);let finish;f.controller.task=async()=>{await new Promise(resolve=>finish=resolve);f.session.complete();};
    const execution=f.session.start();f.session.setFormat(first==="pdf"?"png":"pdf");f.session.abort();assert.equal(f.calls.at(-1),"abort");
    finish();await execution;f.session.setFormat(first);assert.equal(f.session.state.view.phase,"ready");
  });
}
for(const archiveFormat of ["png","jpg","jxl"]){
  for(const [first,next] of [[archiveFormat,"pdf"],["pdf",archiveFormat]]){
    test(`${first}再試行の成功分を保持し${next}への変更で参照を解放する`,async()=>{
      const selected=[image("one"),image("two")];let busy=false,shouldFail=true,session,preparedCount=0,retried=false;
      const lifecycle=createExportLifecycle({cancelledMessage:"cancelled",isBusy:()=>busy,isDisposed:()=>false,
        onBusyChange:value=>{busy=value;},onStatus(){},onScrollToFailures(){}});
      const controller={get pending(){return lifecycle.pending;},get isRunning(){return lifecycle.isRunning;},get progress(){return lifecycle.progress;},
        clear:lifecycle.clear,abort:lifecycle.abort,discardIfSelectionChanged:lifecycle.discardIfSelectionChanged,
        async export(settings){
          const work=lifecycle.resolveWork(selected,()=>({...settings,selected,prepared:new Map(),failed:new Map()}));
          await lifecycle.run(work,"start","",async run=>{
            retried=run.retry;
            for(const item of selected){if(work.prepared.has(item))continue;if(shouldFail&&item===selected[1])work.failed.set(item,"failed");
              else{work.prepared.set(item,{blob:new Blob([new Uint8Array(1024*1024)])});work.failed.delete(item);preparedCount++;}}
            if(!work.failed.size){lifecycle.clear();session.complete();}
          });
        }};
      session=createSplitExportSession({imageFormat:first,videoFormat:"recommend",includeSourcePage:true,
        getSelectedItems:()=>selected,getController:()=>controller,isBusy:()=>busy});
      await session.start();const old=controller.pending;assert.equal(old.prepared.size,1);
      session.setFormat(first);await session.start();assert.equal(retried,true);assert.equal(preparedCount,1);
      session.setFormat(next);assert.equal(controller.pending,null);
      assert.deepEqual(session.selectedItems,selected);assert.equal(session.includeSourcePage,true);
      shouldFail=false;await session.start();assert.equal(preparedCount,3);assert.equal(controller.pending,null);assert.equal(session.state.view.phase,"saved");
    });
  }
}


test("描画スナップショットは一度の選択取得を共有し可変メタデータを次回再評価する",()=>{
  let reads=0;
  const selected=[1,2].map(i=>image(`pages/${i}`));
  const session=createSplitExportSession({imageFormat:"recommend",videoFormat:"recommend",includeSourcePage:true,
    getSelectedItems:()=>{reads++;return selected;},getController:()=>null,isBusy:()=>false});
  const first=session.renderState;
  assert.equal(reads,1);assert.equal(first.resolvedImageFormat,"pdf");
  assert.equal(first.recommendedImageFormat,"pdf");assert.equal(first.recommendations.some(r=>r.format==="pdf"),true);
  selected[1].recommendedFormat="gif";
  const next=session.renderState;
  assert.equal(reads,2);assert.equal(next.recommendedImageFormat,"original");assert.equal(next.resolvedImageFormat,"original");
  assert.equal(first.recommendedImageFormat,"pdf","前回判定値は可変項目の変更で書き換わらない");
  session.setFormat("png");assert.equal(session.renderState.resolvedImageFormat,"png");
  assert.equal(session.renderState.recommendedImageFormat,"original","手動形式でも推奨は現在の対象から独立に算出する");
});

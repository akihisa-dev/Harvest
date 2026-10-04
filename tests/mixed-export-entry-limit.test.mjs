import assert from "node:assert/strict";
import test from "node:test";
import {ImageCollection} from "../dist/extension/core/image-collection.js";
import {storedZipDataLimit, storedZipEntryLimit} from "../dist/extension/core/stored-zip.js";
import {createSplitExportSession} from "../dist/extension/app/panel/split-export-session.js";
import {createMixedExportController} from "../dist/extension/app/panel/mixed-export-controller.js";

test("ZIP件数境界は65535まで受理し、65536を拒否する", () => {
  assert.equal(storedZipEntryLimit, 65_535);
  const names=Array.from({length:storedZipEntryLimit},(_,index)=>`${index}.png`);
  assert.ok(storedZipDataLimit(names)>0);
  assert.throws(()=>storedZipDataLimit([...names,"last.png"]),RangeError);
});

test("現行collection→split→mixedは65536項目を取得前に拒否して参照を解放する", async t => {
  const collection=new ImageCollection();
  collection.replace(Array.from({length:65_536},(_,index)=>`https://example.test/${index}.png`),"https://example.test/gallery");
  collection.setAllSelected(true);
  assert.equal(collection.selectedItems.length,65_536);
  let fetched=0,busy=false,completed=0;
  const reported=[];
  t.mock.method(globalThis,"fetch",async()=>{fetched++;return new Response("missing",{status:404});});
  const controller=createMixedExportController({
    getSelectedItems:()=>collection.selectedItems,getZipFilename:()=>"images.zip",getPdfFilename:()=>"images.pdf",
    isBusy:()=>busy,isDisposed:()=>false,onBusyChange:value=>{busy=value;},onStatus:(...args)=>reported.push(args),
    onCloseViewer(){},onClearSourceUrl(){assert.fail("上限超過時に出典を変更しない");},
    onCompleted(){completed++;},onScrollToFailures(){},
  });
  const session=createSplitExportSession({imageFormat:"png",videoFormat:"original",includeSourcePage:false,
    getSelectedItems:()=>collection.selectedItems,getController:()=>controller,isBusy:()=>busy});
  await session.start();
  assert.equal(fetched,0);
  assert.equal(completed,0);
  assert.equal(busy,false);
  assert.equal(controller.isRunning,false);
  assert.equal(reported.at(-1)[1],"error");
  assert.equal(session.state.view.phase,"ready");
  assert.equal(controller.pending===null,true,"entry-count overflow releases pending work");
  collection.setAllSelected(false);
  collection.setSelected(collection.items[0].url,true);
  session.selectionChanged();
  await session.start();
  assert.equal(fetched,1,"対象を減らした次の保存は新規取得へ進める");
  assert.equal(controller.pending.selected.length,1);
  assert.equal(controller.pending.failed.size,1);
  assert.equal(controller.pending.prepared.size,0);
  assert.equal(completed,0);
});

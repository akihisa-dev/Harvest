import assert from "node:assert/strict";
import test from "node:test";

const {saveSourcePagePreference} = await import("../dist/extension/app/browser/export-preferences.js");
const {exportFileBaseName, imageFilename, createSourcePreview, createExportPresentation} = await import("../dist/extension/app/panel/export-presentation.js");
const {loadSplitExportPreferences} = await import("../dist/extension/app/browser/split-export-preferences.js");
const {createSplitExportSession} = await import("../dist/extension/app/panel/split-export-session.js");
const {createExportLifecycle} = await import("../dist/extension/app/panel/export-lifecycle.js");

function memoryStorage(entries = []) {
  const values = new Map(entries);
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

test("出典設定だけを保存し、両形式は常にrecommendで初期化する", () => {
  const entries = [["harvest.exportFormat", "jxl"], ["harvest.imageExportFormat", "png"], ["harvest.videoExportFormat", "mp4"]];
  const storage = memoryStorage(entries);
  const reads = [], writes = [];
  const get = storage.getItem, set = storage.setItem;
  storage.getItem = key => {reads.push(key); return get(key);};
  storage.setItem = (key,value) => {writes.push([key,String(value)]); set(key,value);};
  const expected = {imageFormat:"recommend", videoFormat:"recommend", includeSourcePage:false};
  assert.deepEqual(loadSplitExportPreferences(storage), expected);
  assert.deepEqual(reads, ["harvest.includeSourcePage"]);
  assert.equal(saveSourcePagePreference(true,storage),true);
  assert.deepEqual(loadSplitExportPreferences(storage), {...expected,includeSourcePage:true});
  assert.equal(saveSourcePagePreference(false,storage),true);
  assert.deepEqual(loadSplitExportPreferences(storage), expected);
  assert.deepEqual(writes, [["harvest.includeSourcePage","true"],["harvest.includeSourcePage","false"]]);
  assert.deepEqual([...storage.values].slice(0,3),entries);
  const unavailable = {getItem(){throw Error("unavailable");},setItem(){throw Error("unavailable");}};
  assert.deepEqual(loadSplitExportPreferences(unavailable),expected);
  assert.equal(saveSourcePagePreference(true,unavailable),false);
});

const image = {url: "https://example.test/image.png", sourcePage: "https://example.test/gallery"};
test("現行splitのempty/ready/running/retry/savedと設定・同一順序を確認する", async () => {
  let selected=[],finish;
  const controller={pending:null,isRunning:false,progress:"",clear(){this.pending=null;},abort(){},discardIfSelectionChanged(){return false;},
    async export(){this.isRunning=true;await new Promise(resolve=>finish=resolve);this.isRunning=false;}};
  const session=createSplitExportSession({imageFormat:"pdf",videoFormat:"recommend",includeSourcePage:false,
    getSelectedItems:()=>selected,getController:()=>controller,isBusy:()=>false});
  assert.equal(session.state.view.phase,"empty");selected=[image];assert.equal(session.state.view.phase,"ready");
  const pending={selected:[image],imageFormat:"pdf",videoFormat:"recommend",includeSourcePage:false,resolvedImageFormat:"pdf",failed:new Map([[image,"failed"]])};
  controller.pending=pending;controller.progress="1 / 2";
  const running=session.start();
  assert.deepEqual(session.state.view,{phase:"running",pending,progress:"1 / 2"});finish();await running;
  assert.deepEqual(session.state.view,{phase:"retry-required",pending,progress:""});
  session.setFormat("png");assert.equal(controller.pending,null);assert.equal(session.state.view.phase,"ready");
  const saved=session.start();session.complete();finish();await saved;assert.equal(session.state.view.phase,"saved");
  selected=[{...image}];assert.equal(session.state.view.phase,"ready","同じURLでも別の項目参照なら保存済みでない");
  selected=[image];assert.equal(session.state.view.phase,"saved");
  session.setIncludeSourcePage(true);assert.equal(session.state.view.phase,"ready","両形式・出典を一つの現行スナップショットで管理する");
  const again=session.start();session.complete();finish();await again;assert.equal(session.state.view.phase,"saved");
  session.setVideoFormat("original");assert.equal(session.state.view.phase,"ready");
});

test("file labels and source preview safely represent URLs and XML text", () => {
  assert.equal(imageFilename("https://example.test/files/a%20b%26c.png?size=2"), "a b&c.png");
  assert.equal(exportFileBaseName('A/B:C*D?E"F<G>H|I', "Harvest"), "A_B_C_D_E_F_G_H_I");
  assert.equal(exportFileBaseName("////", "Harvest"), "____");
  assert.equal(exportFileBaseName("x".repeat(120), "Harvest").length, 100);

  const preview = createSourcePreview([image], "pdf", true, "Source <&> \"'", "file<&>.pdf");
  assert.ok(preview);
  assert.equal(preview.sourcePage, image.sourcePage);
  assert.equal(preview.selected, true);
  const svg = decodeURIComponent(preview.url.slice(preview.url.indexOf(",") + 1));
  assert.match(svg, /Source &lt;&amp;&gt; &quot;&apos;/);
  assert.match(svg, /file&lt;&amp;&gt;\.pdf/);
  assert.match(svg, /https:\/\/example\.test\/gallery/);
  assert.equal(createSourcePreview([image], "jpg", true, "Source", "file.jpg"), null);
  assert.equal(createSourcePreview([image], "pdf", false, "Source", "file.pdf"), null);
  assert.equal(createSourcePreview([], "pdf", true, "Source", "file.pdf"), null);
});

test("出力名・画像一覧の出典・閲覧ページが同じ選択順序と形式を反映する", () => {
  let title = "Title / test";
  let selection = {format: "pdf", videoFormat: "recommend", includeSourcePage: true, selected: [image, {...image, url: "https://example.test/second.png"}]};
  const presentation = createExportPresentation({
    getTitle: () => title,
    getSelection: () => selection,
    fallbackTitle: "Images",
    sourceHeading: "Source",
  });
  assert.equal(presentation.resultFilename, "Title _ test.pdf");
  assert.equal(presentation.pdfFilename, "Title _ test.pdf");
  assert.equal(presentation.zipFilename, "Title _ test.zip");
  assert.deepEqual(presentation.viewerPages.slice(0, 2), selection.selected);
  assert.equal(presentation.viewerPages.at(-1).url, presentation.sourcePreview.url);
  selection = {...selection, selected: [...selection.selected].reverse()};
  assert.equal(presentation.viewerPages[0], selection.selected[0]);
  assert.equal(presentation.viewerPages.at(-1).sourcePage, selection.selected[0].sourcePage);
  for (const format of ["jpg", "png", "jxl"]) {
    selection = {...selection, format};
    assert.equal(presentation.sourcePreview, null, format);
    assert.deepEqual(presentation.viewerPages, selection.selected, format);
    assert.equal(presentation.resultFilename, "Title _ test.zip", format);
    selection = {...selection, selected: [image]};
    assert.equal(presentation.resultFilename, `Title _ test.${format}`, format);
    selection = {...selection, selected: [image, {...image}]};
  }
  for (const [item, format, extension] of [
    [{...image,url:"https://example.test/animation.gif",kind:"gif"},"png","gif"],
    [{...image,url:"https://example.test/movie.mp4",kind:"video"},"pdf","mp4"],
  ]) {
    selection={...selection,format,videoFormat:"recommend",selected:[item]};
    assert.equal(presentation.resultFilename,`Title _ test.${extension}`);
    assert.equal(presentation.sourcePreview,null);
    assert.deepEqual(presentation.viewerPages,selection.selected);
    selection={...selection,selected:[item,{...item}]};
    assert.equal(presentation.resultFilename,extension==="mp4"?"Title _ test_001.mp4":"Title _ test.zip");
    assert.equal(presentation.sourcePreview,null);
    assert.deepEqual(presentation.viewerPages,selection.selected);
  }
  title = "...";
  selection = {...selection, format: "pdf", selected: []};
  assert.equal(presentation.resultFilename, "Images.pdf");
  assert.equal(presentation.sourcePreview, null);
  assert.deepEqual(presentation.viewerPages, []);
});

test("shared export lifecycle discards changed selections and cleans up aborted work", async () => {
  const statuses = [];
  const busyChanges = [];
  let scrolledToFailures = 0;
  let disposed = false;
  const lifecycle = createExportLifecycle({
    cancelledMessage: "Saving cancelled",
    isBusy: () => false,
    isDisposed: () => disposed,
    onBusyChange: value => busyChanges.push(value),
    onStatus: (...args) => statuses.push(args),
    onScrollToFailures: () => { scrolledToFailures += 1; },
  });
  const changedImage = {url: "https://example.test/changed.png"};
  const work = lifecycle.resolveWork([image], () => ({selected: [image], prepared: new Map(), failed: new Map()}));
  assert.equal(lifecycle.pending, work);
  assert.equal(lifecycle.discardIfSelectionChanged([image]), false);
  assert.equal(lifecycle.discardIfSelectionChanged([changedImage]), true);
  assert.equal(lifecycle.pending, null);

  const runWork = lifecycle.resolveWork([image], () => ({selected: [image], prepared: new Map(), failed: new Map()}));
  let runSignal;
  let stoppedAfterAbort = false;
  const execution = lifecycle.run(runWork, "Preparing", "0 / 1", async run => {
    runSignal = run.signal;
    runWork.prepared.set(image, new Blob(["prepared image"]));
    runWork.failed.set(changedImage, "failed image");
    await new Promise(resolve => runSignal.addEventListener("abort", resolve, {once: true}));
    stoppedAfterAbort = run.stopped;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(lifecycle.isRunning, true);
  assert.equal(lifecycle.progress, "0 / 1");
  lifecycle.abort();
  await execution;
  assert.equal(runSignal.aborted, true);
  assert.equal(stoppedAfterAbort, true);
  assert.equal(lifecycle.pending, null, "cancelled work is discarded before another save");
  assert.equal(runWork.prepared.size, 0, "prepared image memory is released on cancellation");
  assert.equal(runWork.failed.size, 0, "cancelled failures do not turn the next save into a retry");
  assert.equal(statuses.at(-1)[1], "info", "cancellation is not reported as an error");
  assert.equal(lifecycle.isRunning, false);
  assert.equal(lifecycle.progress, "");
  assert.deepEqual(busyChanges, [true, false]);
  assert.deepEqual(statuses[0], ["Preparing", "busy", "0 / 1"]);
  assert.equal(scrolledToFailures, 0);
});

test("export lifecycle replaces incompatible pending work and scrolls to retained failures", async () => {
  let scrolledToFailures = 0;
  const lifecycle = createExportLifecycle({
    cancelledMessage: "Saving cancelled",
    isBusy: () => false,
    isDisposed: () => false,
    onBusyChange() {},
    onStatus() {},
    onScrollToFailures: () => { scrolledToFailures += 1; },
  });
  const first = lifecycle.resolveWork([image], () => ({format: "png", selected: [image], prepared: new Map(), failed: new Map()}));
  const replacement = lifecycle.resolveWork([image], () => ({format: "jpg", selected: [image], prepared: new Map(), failed: new Map()}), work => work.format === "jpg");
  assert.notEqual(replacement, first);
  assert.equal(lifecycle.pending, replacement);
  replacement.failed.set(image, "Could not prepare image");
  await lifecycle.run(replacement, "Retrying", "0 / 1", async run => {
    assert.equal(run.retry, true);
    run.reportStatus("Could not prepare image", "error");
  });
  assert.equal(lifecycle.pending, replacement);
  assert.equal(scrolledToFailures, 1);
});

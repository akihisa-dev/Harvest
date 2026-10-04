import assert from 'node:assert/strict';
import test from 'node:test';
import {loadSplitExportPreferences} from '../dist/extension/app/browser/split-export-preferences.js';
function storage(entries = []) {
 const values = new Map(entries), reads = [], writes = [];
 return {values, reads, writes,
  getItem(key) {reads.push(key); return values.get(key) ?? null;},
  setItem(key, value) {writes.push([key, value]); values.set(key, value);},
 };
}
test('画像と動画は保存済み形式を参照・変更せず常に推奨で始め、出典設定だけ復元する', () => {
 for (const previous of ['original', 'recommend', 'pdf', 'jpg', 'png', 'jxl', 'mp4', 'gif', 'unknown']) {
  for (const includeSourcePage of [false, true]) {
   const entries = [
    ['harvest.exportFormat', previous], ['harvest.imageExportFormat', previous],
    ['harvest.videoExportFormat', previous], ['harvest.includeSourcePage', String(includeSourcePage)],
   ];
   const s = storage(entries);
   assert.deepEqual(loadSplitExportPreferences(s), {imageFormat: 'recommend', videoFormat: 'recommend', includeSourcePage});
   assert.deepEqual(s.reads, ['harvest.includeSourcePage']);
   assert.deepEqual(s.writes, []);
   assert.deepEqual([...s.values], entries);
  }
 }
 const empty = storage();
 assert.deepEqual(loadSplitExportPreferences(empty), {imageFormat: 'recommend', videoFormat: 'recommend', includeSourcePage: false});
 assert.deepEqual([...empty.values], []);
 const broken = {getItem() {throw Error('unavailable');}, setItem() {throw Error('unavailable');}};
 assert.deepEqual(loadSplitExportPreferences(broken), {imageFormat: 'recommend', videoFormat: 'recommend', includeSourcePage: false});
});

test('両形式の一保存セッションは全件と順序を固定し、設定変更/中止/クリア後の成功を拒否する',async()=>{
 const {createSplitExportSession}=await import('../dist/extension/app/panel/split-export-session.js');
 const image={url:'a.png',selected:true},video={url:'b.mp4',kind:'video',selected:true},gif={url:'c.gif',kind:'gif',selected:true};let selected=[video,image,gif],snapshot,finish;const controller={pending:null,isRunning:false,progress:'',clear(){this.pending=null;},abort(){this.aborted=true;},discardIfSelectionChanged(){return false;},async export(value){snapshot=value;this.isRunning=true;await new Promise(resolve=>finish=resolve);this.isRunning=false;session.complete();}};
 const session=createSplitExportSession({imageFormat:'pdf',videoFormat:'mp4',includeSourcePage:true,getSelectedItems:()=>selected,getController:()=>controller,isBusy:()=>false});
 let work=session.start();assert.deepEqual(snapshot.selected,[video,image,gif]);assert.equal(snapshot.imageFormat,'pdf');assert.equal(snapshot.videoFormat,'mp4');selected.reverse();session.selectionChanged();finish();await work;assert.equal(session.state.view.phase,'ready');
 work=session.start();session.setVideoFormat('original');finish();await work;assert.equal(session.state.view.phase,'ready');assert.equal(snapshot.videoFormat,'mp4');
 work=session.start();session.abort();finish();await work;assert.equal(controller.aborted,true);assert.equal(session.state.view.phase,'ready');
 work=session.start();finish();await work;assert.equal(session.state.view.phase,'saved');session.clear();assert.equal(session.state.view.phase,'ready');
});

test('出典プレビューと実PDFは直接名またはZIP内番号名の共通規則を使う',async()=>{
 const {createExportPresentation}=await import('../dist/extension/app/panel/export-presentation.js');
 const {pdfSourceFilename}=await import('../dist/extension/core/split-export-formats.js');
 const image={url:'a.png',sourcePage:'https://example.test/source',selected:true},video={url:'b.mp4',kind:'video',selected:true};
 let selected=[image];const presentation=createExportPresentation({getTitle:()=> 'layout',getSelection:()=>({format:'pdf',videoFormat:'mp4',includeSourcePage:true,selected}),fallbackTitle:'Harvest',sourceHeading:'Source'});
 for(const [items,name,index,other] of [[[image],'layout.pdf',0,0],[[image,video],'001.pdf',0,1],[[video,image],'002.pdf',1,1]]){
  selected=items;const source=decodeURIComponent(presentation.sourcePreview.url);assert.ok(source.includes(name));assert.ok(decodeURIComponent(presentation.viewerPages.at(-1).url).includes(name));assert.equal(pdfSourceFilename(items.length,index,other,'layout.pdf'),name);
 }
});

test('推奨の実形式は保存と再試行の間固定し、選択変更後に判定し直す', async () => {
 const {createSplitExportSession} = await import('../dist/extension/app/panel/split-export-session.js');
 const {createExportPresentation} = await import('../dist/extension/app/panel/export-presentation.js');
 const items = [1, 2].map(index => ({url:`https://example.test/pages/${index}.png`, sourcePage:'https://example.test/series', selected:true}));
 let selected = items, finish;
 const snapshots = [];
 const controller = {
  pending:null, isRunning:false, progress:'', clear(){this.pending=null;}, abort(){},
  discardIfSelectionChanged(){this.pending=null; return true;},
  async export(snapshot) {
   snapshots.push(snapshot); this.isRunning=true;
   this.pending={...snapshot, failed:new Map([[items[0], 'retry']])};
   await new Promise(resolve => {finish=resolve;}); this.isRunning=false;
  },
 };
 const session = createSplitExportSession({imageFormat:'recommend', videoFormat:'recommend', includeSourcePage:true,
  getSelectedItems:()=>selected, getController:()=>controller, isBusy:()=>false});
 const presentation = createExportPresentation({getTitle:()=> 'series', getSelection:()=>({...session.state}), fallbackTitle:'Harvest', sourceHeading:'Source'});
 assert.equal(session.resolvedImageFormat, 'pdf');
 assert.equal(presentation.resultFilename, 'series.pdf');
 assert.ok(presentation.sourcePreview);
 let work=session.start();
 items[1].recommendedFormat='gif';
 assert.equal(session.resolvedImageFormat, 'pdf', '取得後に動く画像と判明しても進行中の実形式を切り替えない');
 assert.equal(presentation.resultFilename, 'series.zip', '実際の静止PDFと動く画像の混在を反映する');
 finish(); await work;
 assert.equal(session.state.view.phase, 'retry-required');
 assert.equal(session.resolvedImageFormat, 'pdf');
 work=session.start();
 assert.equal(snapshots[1].resolvedImageFormat, 'pdf', '再試行でも準備済みPDFを再利用できる');
 session.complete();controller.pending=null;finish();await work;
 assert.equal(session.state.view.phase, 'saved');assert.equal(session.resolvedImageFormat, 'pdf');
 selected=[items[0]];session.selectionChanged();
 assert.equal(session.resolvedImageFormat, 'original');
 assert.equal(presentation.resultFilename, 'series.png');
 assert.equal(presentation.sourcePreview, null);
 assert.equal(session.format, 'recommend', '自動選択モードは維持する');
});

test('中止で準備済みPDFを破棄した最後の描画から、判明した画像の種類に合う推奨へ戻す', async () => {
 const {createSplitExportSession} = await import('../dist/extension/app/panel/split-export-session.js');
 const {createExportPresentation} = await import('../dist/extension/app/panel/export-presentation.js');
 const {createExportLifecycle} = await import('../dist/extension/app/panel/export-lifecycle.js');
 const selected = [1, 2].map(index => ({url:`https://example.test/pages/${index}.png`, sourcePage:'https://example.test/series', selected:true}));
 let busy = false, finish, lastRendered;
 const snapshots = [];
 const lifecycle = createExportLifecycle({
  cancelledMessage:'cancelled', isBusy:()=>busy, isDisposed:()=>false, onStatus(){}, onScrollToFailures(){},
  onBusyChange(value) {
   busy=value;
   if (!value) lastRendered={phase:session.state.view.phase, format:session.resolvedImageFormat, source: presentation.sourcePreview};
  },
 });
 const controller = {
  get pending(){return lifecycle.pending;}, get isRunning(){return lifecycle.isRunning;}, get progress(){return lifecycle.progress;},
  clear:lifecycle.clear, abort:lifecycle.abort, discardIfSelectionChanged:lifecycle.discardIfSelectionChanged,
  async export(snapshot) {
   snapshots.push(snapshot);
   const work=lifecycle.resolveWork(snapshot.selected, ()=>({...snapshot, prepared:new Map(), failed:new Map()}));
   await lifecycle.run(work, 'preparing', '0 / 2', async ()=>new Promise(resolve=>{finish=resolve;}));
  },
 };
 const session = createSplitExportSession({imageFormat:'recommend', videoFormat:'recommend', includeSourcePage:true,
  getSelectedItems:()=>selected, getController:()=>controller, isBusy:()=>busy});
 const presentation = createExportPresentation({getTitle:()=> 'series', getSelection:()=>({...session.state}), fallbackTitle:'Harvest', sourceHeading:'Source'});
 const work=session.start();
 assert.equal(session.resolvedImageFormat, 'pdf');
 selected[1].recommendedFormat='gif';
 assert.equal(session.resolvedImageFormat, 'pdf', '保存処理が動いている間はPDFを維持する');
 session.abort();finish();await work;
 assert.equal(lifecycle.pending, null, '中止した準備データは再利用しない');
 assert.deepEqual(lastRendered, {phase:'ready', format:'original', source:null}, '保存終了を描画する時点で旧PDFの形式と出典ページを残さない');
 assert.equal(session.resolvedImageFormat, lastRendered.format, '描画後のセッション状態も一致する');
 const next=session.start();
 assert.equal(snapshots[1].resolvedImageFormat, lastRendered.format, '次の保存は表示された推奨形式で始める');
 finish();await next;
});

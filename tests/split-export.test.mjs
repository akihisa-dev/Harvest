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

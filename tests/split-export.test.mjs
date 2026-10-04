import assert from 'node:assert/strict';
import test from 'node:test';
import {loadSplitExportPreferences,saveImageExportFormat,saveVideoExportFormat} from '../dist/extension/app/browser/split-export-preferences.js';
function storage(entries=[]){const values=new Map(entries);return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),values};}
test('画像/動画保存設定は全旧値を移行し、有効な新値と出典設定を維持する',()=>{
 const migration={original:['original','original'],recommend:['recommend','recommend'],pdf:['pdf','recommend'],jpg:['jpg','recommend'],png:['png','recommend'],jxl:['jxl','recommend'],mp4:['recommend','mp4'],gif:['recommend','recommend'],unknown:['recommend','recommend']};
 for(const [legacy,[imageFormat,videoFormat]] of Object.entries(migration)){
  const s=storage([['harvest.exportFormat',legacy],['harvest.includeSourcePage','true']]);assert.deepEqual(loadSplitExportPreferences(s),{imageFormat,videoFormat,includeSourcePage:true});assert.equal(s.values.get('harvest.exportFormat'),legacy);
  assert.equal(s.values.get('harvest.imageExportFormat'),imageFormat);assert.equal(s.values.get('harvest.videoExportFormat'),videoFormat);
  assert.equal(saveImageExportFormat('jxl',s),true);assert.equal(saveVideoExportFormat('original',s),true);assert.deepEqual(loadSplitExportPreferences(s),{imageFormat:'jxl',videoFormat:'original',includeSourcePage:true});
 }
 assert.deepEqual(loadSplitExportPreferences(storage()),{imageFormat:'recommend',videoFormat:'recommend',includeSourcePage:false});
 const broken={getItem(){throw Error('unavailable');},setItem(){throw Error('unavailable');}};assert.deepEqual(loadSplitExportPreferences(broken),{imageFormat:'recommend',videoFormat:'recommend',includeSourcePage:false});assert.equal(saveImageExportFormat('png',broken),false);assert.equal(saveVideoExportFormat('mp4',broken),false);
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

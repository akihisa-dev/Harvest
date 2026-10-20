import assert from 'node:assert/strict';
import test from 'node:test';
import {createSourcePageLayout} from '../dist/extension/core/source-page-layout.js';
import {createExportPresentation} from '../dist/extension/app/panel/export-presentation.js';

for(const length of [8000,16000])test(`長いURLのサイズ候補間で書記素分割を再利用する: ${length}`,t=>{
  const url='https://example.test/#'+'a'.repeat(length);let splits=0;
  const original=Intl.Segmenter.prototype.segment;
  t.mock.method(Intl.Segmenter.prototype,'segment',function(value){if(value===url)splits++;return original.call(this,value);});
  const layout=createSourcePageLayout({heading:'Source',filename:'name.pdf',url});
  assert.equal(splits,1);
  assert.equal(layout.lines.slice(2).map(line=>line.text).join(''),url);
  assert.ok(layout.lines.every(line=>line.width<=layout.width-layout.margin*2+1));
});

test('一覧とViewerの出典を共有し、URL・保存名・設定変更で更新する',()=>{
  let title='first';
  let selection={format:'pdf',videoFormat:'mp4',includeSourcePage:true,selected:[{url:'https://example.test/1.png',sourcePage:'https://example.test/#first',selected:true,kind:'image'}]};
  const presentation=createExportPresentation({getTitle:()=>title,getSelection:()=>selection,fallbackTitle:'Harvest',sourceHeading:'Source'});
  const first=presentation.sourcePreview;
  assert.equal(presentation.viewerPages.at(-1),first);
  title='second';const renamed=presentation.sourcePreview;assert.notEqual(renamed,first);
  assert.match(decodeURIComponent(renamed.url),/second.pdf/);
  selection={...selection,selected:[{...selection.selected[0],sourcePage:'https://example.test/#second'}]};
  const changed=presentation.sourcePreview;assert.notEqual(changed,renamed);
  assert.equal(presentation.viewerPages.at(-1),changed);
  selection={...selection,includeSourcePage:false};assert.equal(presentation.sourcePreview,null);
  selection={...selection,includeSourcePage:true};assert.notEqual(presentation.sourcePreview,changed);
});

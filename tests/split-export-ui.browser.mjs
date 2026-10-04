import assert from 'node:assert/strict';import test from 'node:test';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {animationPanel} from './support/animation-panel.mjs';import {redPng} from './animation-fixtures.mjs';import {mp4Bytes} from './media-fixtures.mjs';
test('日英320/400/800幅と明暗で独立形式を表示し、キーボードと再解析で両設定を保つ',{timeout:60000},async t=>{
 for(const locale of ['ja-JP','en-US']){
  const {page,scan}=await animationPanel(t,new Map([['/red.png',[redPng,'image/png']],['/movie.mp4',[mp4Bytes,'video/mp4']]]),{locale});await scan(['/red.png','/movie.mp4'],'layout');
  await page.locator('#export-format-original').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#export-format-recommend').isChecked(),true);
  await page.locator('#video-export-format-original').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#video-export-format-mp4').isChecked(),true);assert.equal(await page.locator('#export-format-recommend').isChecked(),true);
  await page.locator('#export-format-pdf').check();await page.locator('#include-source-page').check();
  for(const colorScheme of ['light','dark'])for(const width of [320,400,800]){
   await page.emulateMedia({colorScheme,reducedMotion:'reduce'});await page.setViewportSize({width,height:800});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.locator('#image-export-formats').isVisible(),true);assert.equal(await page.locator('#video-export-formats').isVisible(),true);
   const clipped=await page.locator('.export-formats label').evaluateAll(labels=>labels.filter(label=>{const rect=label.getBoundingClientRect();return rect.width>0&&(rect.left<0||rect.right>innerWidth);}).length);assert.equal(clipped,0);
   await page.screenshot({path:join(tmpdir(),`harvest-split-${locale}-${colorScheme}-${width}.png`)});
  }
  // Measure actual glyph ranges, including wrapped busy/cancel/retry labels at the narrowest width.
  await page.setViewportSize({width:320,height:800});
  const measurements=await page.evaluate(async()=>{
   const {t}=await import('./panel/localization.js'),{setButtonLabel}=await import('./panel/button-state.js');
   const button=document.querySelector('#export'),results=[];
   const labels=[...[1,2,999,1000].map(count=>t('exportSelectionAction',{count,plural:count===1?'':'s'})),t('prepareFiles',{completed:999,total:1000}),t('saveFiles',{completed:999,total:1000}),t('exportCancelHint'),t('exportRetry')];
   for(const label of labels){
    button.dataset.saving=String(label.includes('…')||label.includes('999'));setButtonLabel(button,label);
    const range=document.createRange();range.selectNodeContents(button.querySelector('.button-label'));const bounds=button.getBoundingClientRect(),style=getComputedStyle(button),left=bounds.left+parseFloat(style.paddingLeft)+1,right=bounds.right-parseFloat(style.paddingRight)-1;
    results.push({label,clipped:[...range.getClientRects()].some(rect=>rect.left<left-.5||rect.right>right+.5||rect.top<bounds.top||rect.bottom>bounds.bottom)});
   }
   button.dataset.saving='false';return results;
  });
  assert.deepEqual(measurements.filter(value=>value.clipped),[]);
  await scan(['/red.png'],'image-only');assert.equal(await page.locator('#video-export-formats').isVisible(),false);await scan(['/red.png','/movie.mp4'],'rescan');assert.equal(await page.locator('#export-format-pdf').isChecked(),true);assert.equal(await page.locator('#video-export-format-mp4').isChecked(),true);assert.equal(await page.locator('#include-source-page').isChecked(),true);
 }
});

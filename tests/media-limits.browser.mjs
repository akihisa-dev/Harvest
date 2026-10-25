import assert from 'node:assert/strict';
import test from 'node:test';
import {animationPanel} from './support/animation-panel.mjs';
import {mp4Bytes} from './media-fixtures.mjs';

test('実Chromeで108 MiBのMP4を取得し、recommended保存の完了と全バイトを確認する',{timeout:60000},async t=>{
  const bytes=Buffer.alloc(108*1024*1024);mp4Bytes.copy(bytes);
  bytes.writeUInt32BE(bytes.length-mp4Bytes.length,mp4Bytes.length);bytes.write('free',mp4Bytes.length+4);bytes[bytes.length-1]=7;
  const {page,scan,saved}=await animationPanel(t,new Map([['/large.mp4',[bytes,'video/mp4']]]));
  await scan(['/large.mp4'],'large');
  const output=await saved('recommend');
  assert.equal(output.bytes.length,bytes.length);assert.deepEqual(output.bytes,bytes);
  assert.equal(await page.locator('#status').getAttribute('data-state'),'success');
});

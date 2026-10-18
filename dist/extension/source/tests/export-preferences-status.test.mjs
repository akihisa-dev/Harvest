import assert from 'node:assert/strict';
import test from 'node:test';
import {createSplitExportSession} from '../dist/extension/app/panel/split-export-session.js';
import {bindExportPreferences} from '../dist/extension/app/panel/export-preferences-controller.js';

function input(checked) {
  return {checked, addEventListener(name, listener) {this.change = listener;}};
}

test('設定変更で破棄した失敗だけを解除し、同一設定・処理中・無関係のエラーを維持する', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable:true, value:{setItem() {}}});
  t.after(() => {if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage;});
  for (const kind of ['image', 'video', 'source']) for (const state of ['retry', 'same', 'running', 'unrelated', 'storage-error']) {
    let status = {message: state === 'running' ? 'processing' : 'previous error', state: state === 'running' ? 'busy' : 'error'};
    const selected = [{url: 'https://example.test/a.png', selected: true}];
    const controller = {pending: ['retry','same','storage-error'].includes(state) ? {failed: new Map([[selected[0], 'failed']])} : null,
      isRunning: state === 'running', progress: 'processing', clear() {this.pending = null;}};
    const session = createSplitExportSession({imageFormat:'png',videoFormat:'original',includeSourcePage:false,getSelectedItems:()=>selected,getController:()=>controller,isBusy:()=>controller.isRunning});
    const image = input(true), video = input(true), source = input(state !== 'same');
    const elements = {includeSourcePage:source,exportFormatInputs:[{format:state === 'same' ? 'png' : 'jpg',input:image}],videoExportFormatInputs:[{format:state === 'same' ? 'original' : 'mp4',input:video}]};
    globalThis.localStorage.setItem = () => {if (state === 'storage-error') throw new Error('unavailable');};
    bindExportPreferences({elements,session,onStatus:(message,state)=>{status={message,state};},onSelectionChange(){},onRender(){}});
    ({image,video,source}[kind]).change();
    if (state === 'retry' || (state === 'storage-error' && kind !== 'source')) {
      assert.equal(status.state,'info'); assert.match(status.message,/保存設定|save settings/);
      assert.equal(controller.pending,null);
    } else if (state === 'storage-error') {
      assert.equal(status.state,'error'); assert.match(status.message,/出典ページ|source page/);
    } else {
      assert.equal(status.message, state === 'running' ? 'processing' : 'previous error', `${kind}/${state}`);
      if (state === 'same') assert.ok(controller.pending);
    }
  }
});

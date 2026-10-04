import assert from 'node:assert/strict';
import test from 'node:test';
import {createMixedExportController} from '../dist/extension/app/panel/mixed-export-controller.js';

test('件数上限を超える原本・推奨保存は通信を始めず準備状態を解放する', async () => {
  const selected = Array.from({length: 65536}, (_, index) => ({
    url: `https://example.test/pages/${index}.png`, sourcePage: 'https://example.test/series', selected: true,
  }));
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {requests++; throw new Error('上限を超えた選択を取得してはいけません');};
  try {
    for (const imageFormat of ['original', 'recommend']) {
      const statuses = [];
      let busy = false, completed = 0;
      const controller = createMixedExportController({
        getSelectedItems: () => selected, getPdfFilename: () => 'series.pdf', getZipFilename: () => 'series.zip',
        isBusy: () => busy, isDisposed: () => false,
        onBusyChange: value => {busy = value;}, onStatus: (message, state) => statuses.push({message, state}),
        onCloseViewer() {}, onClearSourceUrl() {}, onScrollToFailures() {},
        onCompleted() {completed++;},
      });
      await controller.export({imageFormat, videoFormat: 'recommend', includeSourcePage: false});
      assert.equal(requests, 0, '上限は取得より先に検査する');
      assert.equal(controller.pending, null, '大量の選択スナップショットと準備データを保持しない');
      assert.equal(controller.isRunning, false);
      assert.equal(completed, 0, '上限超過を保存成功にしない');
      assert.equal(busy, false);
      assert.equal(statuses.at(-1).state, 'error');
      assert.match(statuses.at(-1).message, /上限|limit/);
    }
  } finally {globalThis.fetch = originalFetch;}
});

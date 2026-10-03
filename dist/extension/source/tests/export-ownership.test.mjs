import assert from "node:assert/strict";
import test from "node:test";
import {createPdfExportController} from "../dist/extension/app/panel/pdf-export-controller.js";
import {createImageExportController} from "../dist/extension/app/panel/image-export-controller.js";

for (const kind of ["pdf", "image"]) {
  function create(getSelectedItems, isDisposed = () => false) {
    const options = {
      getSelectedItems, isDisposed, isBusy: () => false,
      onBusyChange() {}, onStatus() {}, onCloseViewer() {}, onClearSourceUrl() {}, onScrollToFailures() {},
      getFilename: () => "images.pdf", getSourcePage: () => undefined, getZipFilename: () => "images.zip",
    };
    return kind === "pdf" ? createPdfExportController(options) : createImageExportController(options);
  }

  test(`${kind}: 外部のbusy反映前の重複開始でも、実行中の対象と再試行データを保持する`, async t => {
    const previousFetch = globalThis.fetch;
    let failFetch;
    globalThis.fetch = () => new Promise((_resolve, reject) => { failFetch = reject; });
    t.after(() => { globalThis.fetch = previousFetch; });
    const first = {url: "https://example.test/first.jpg", selected: true};
    const second = {url: "https://example.test/second.jpg", selected: true};
    let selected = [first];
    const controller = create(() => selected);
    const running = controller.export("original");
    try {
      for (let i = 0; i < 20 && !failFetch; i++) await new Promise(resolve => setImmediate(resolve));
      assert.equal(typeof failFetch, "function");
      const pending = controller.pending;
      selected = [second];
      await controller.export("png");
      assert.equal(controller.pending, pending);
      assert.deepEqual(controller.pending.selected, [first]);
    } finally {
      failFetch?.(new Error("fixture fetch failure"));
      await running;
    }
    assert.equal(controller.pending.failed.has(first), true);
    assert.equal(controller.pending.failed.has(second), false);
    assert.equal(controller.isRunning, false);
  });

  test(`${kind}: 廃棄後の開始は選択を読まず、再試行データも作らない`, async () => {
    const controller = create(() => { throw new Error("disposed selection was read"); }, () => true);
    await controller.export("original");
    assert.equal(controller.pending, null);
    assert.equal(controller.isRunning, false);
  });
}

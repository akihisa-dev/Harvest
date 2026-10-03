import assert from "node:assert/strict";
import test from "node:test";
import {createSourceInputController} from "../dist/extension/app/source-input-controller.js";

class Element extends EventTarget {
  value = "";
  hidden = false;
  dataset = {};
  textContent = "";
  focus() { this.focused = true; }
  select() { this.selected = true; }
}

function fixture() {
  const input = new Element();
  const display = new Element();
  const dropOverlay = new Element();
  const eventTarget = new EventTarget();
  const state = {busy: false, reordering: false, scans: [], filename: "結果.pdf"};
  const controller = createSourceInputController({
    input,
    display,
    dropOverlay,
    eventTarget,
    placeholder: "Drop a URL",
    getResultFilename: () => state.filename,
    isBusy: () => state.busy,
    isReordering: () => state.reordering,
    onScan: () => state.scans.push(controller.enteredUrl),
  });
  controller.render();
  return {input, display, dropOverlay, eventTarget, state, controller};
}

function drag(target, type, text, types = ["text/uri-list"]) {
  const event = new Event(type, {cancelable: true});
  event.dataTransfer = {types, getData: () => text, dropEffect: "none"};
  target.dispatchEvent(event);
  return event;
}

test("URLの下書き・確定した出典・保存後の表示・クリアは別の意味を保つ", () => {
  const {controller, input, display} = fixture();
  assert.equal(display.dataset.hasUrl, "false");
  controller.setDraft(" https://example.test/request ");
  assert.equal(controller.enteredUrl, "https://example.test/request");
  controller.commitResult("https://example.test/redirected");
  controller.setDraft("https://example.test/retry");
  input.dispatchEvent(new Event("blur"));
  assert.equal(display.textContent, "結果.pdf");
  assert.equal(controller.enteredUrl, "https://example.test/retry");

  controller.clearAfterExport();
  assert.equal(controller.enteredUrl, "");
  assert.equal(display.dataset.hasUrl, "false");
  controller.setDraft("https://example.test/failed-next");
  assert.equal(display.textContent, "結果.pdf", "旧結果が残る再解析失敗では出典も保つ");
  controller.commitResult("https://example.test/next");
  assert.equal(display.textContent, "結果.pdf");
  controller.reset();
  controller.setDraft("https://example.test/fresh");
  assert.equal(display.textContent, "https://example.test/fresh", "全消去では旧結果の出典を残さない");
});

test("URLドロップは入れ子の領域でも案内を保ち、処理中・並べ替え中は解析を始めない", () => {
  const {controller, input, display, dropOverlay, eventTarget, state} = fixture();
  controller.setDraft("https://example.test/old");
  display.dispatchEvent(new Event("click"));
  assert.equal(input.focused, true);
  assert.equal(input.selected, true);
  drag(eventTarget, "dragenter", "");
  drag(eventTarget, "dragenter", "");
  const over = drag(eventTarget, "dragover", "");
  assert.equal(over.defaultPrevented, true);
  assert.equal(over.dataTransfer.dropEffect, "copy");
  drag(eventTarget, "dragleave", "");
  assert.equal(dropOverlay.hidden, false);
  drag(eventTarget, "dragleave", "");
  assert.equal(dropOverlay.hidden, true);

  drag(eventTarget, "drop", "# source\r\nhttps://example.test/dropped\r\nhttps://example.test/ignored");
  assert.deepEqual(state.scans, ["https://example.test/dropped"]);
  assert.equal(input.hidden, true);
  assert.equal(dropOverlay.hidden, true);
  for (const field of ["busy", "reordering"]) {
    state[field] = true;
    assert.equal(drag(eventTarget, "dragover", "").defaultPrevented, false);
    assert.equal(drag(eventTarget, "drop", "https://example.test/blocked").defaultPrevented, true);
    state[field] = false;
  }
  assert.equal(drag(eventTarget, "drop", "file:///local").defaultPrevented, false);
  assert.deepEqual(state.scans, ["https://example.test/dropped"]);
  assert.equal(controller.enteredUrl, "https://example.test/dropped");
});


test("ファイル名表示をクリックするとURLを編集でき、形式変更は表示だけを更新する", () => {
  const {controller, input, display, state} = fixture();
  controller.commitResult("https://example.test/page");
  assert.equal(display.textContent, "結果.pdf");
  display.dispatchEvent(new Event("click"));
  assert.equal(input.hidden, false);
  assert.equal(display.hidden, true);
  assert.equal(input.value, "https://example.test/page");
  assert.equal(input.selected, true);
  input.value = "https://example.test/next";
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new Event("blur"));
  state.filename = "結果.zip";
  controller.render();
  assert.equal(display.textContent, "結果.zip");
  display.dispatchEvent(new Event("click"));
  const enter = new Event("keydown");
  enter.key = "Enter";
  input.dispatchEvent(enter);
  assert.deepEqual(state.scans, ["https://example.test/next"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import {createExportSession} from "../dist/extension/app/export-session.js";

const image = name => ({url:`https://images.example.test/${name}.png`, sourcePage:"https://example.test/", selected:true});

function fixture() {
  let selected = [image("a"), image("b")];
  let busy = false;
  const calls = [];
  const port = name => ({
    pending:null, isRunning:false, progress:"", task:async () => {},
    clear() { calls.push([name, "clear"]); this.pending = null; },
    abort() { calls.push([name, "abort"]); },
    discardIfSelectionChanged(items) {
      calls.push([name, "selection"]);
      if (!this.pending || this.pending.selected.length === items.length && this.pending.selected.every((item,index) => item === items[index])) return false;
      this.pending = null;
      return true;
    },
    async export(format) {
      calls.push([name, "export", format]);
      this.isRunning = true;
      busy = true;
      try { await this.task(); }
      finally { this.isRunning = false; busy = false; }
    },
  });
  const pdf = port("pdf");
  const archive = port("image");
  const session = createExportSession({
    format:"pdf", includeSourcePage:false,
    getSelectedItems:() => selected, getPdfController:() => pdf, getImageController:() => archive,
    isBusy:() => busy,
  });
  return {session, pdf, archive, calls, get selected() { return selected; }, set selected(items) { selected = items; }};
}

const work = (selected, format) => ({selected:[...selected], format, prepared:new Map(), failed:new Map([[selected[0], "failed"]])});

test("保存状態の参照は再試行データを変更せず、選択変更イベントだけが古い対象を破棄する", () => {
  const f = fixture();
  const pdfWork = work(f.selected);
  const imageWork = work(f.selected, "png");
  f.pdf.pending = pdfWork;
  f.archive.pending = imageWork;
  f.selected = [...f.selected].reverse();
  for (let i = 0; i < 3; i++) {
    assert.equal(f.session.state.view.phase, "retry-required");
    assert.equal(f.session.state.view.pending, pdfWork);
  }
  assert.deepEqual(f.calls, [], "表示の読み取りから準備済みデータを破棄しない");
  assert.equal(f.session.selectionChanged(), true);
  assert.equal(f.pdf.pending, null);
  assert.equal(f.archive.pending, null, "PDF側の破棄が成功しても画像側を確認する");
  assert.equal(f.session.state.view.phase, "ready");
});

test("同じ対象と出典設定の変更は再試行を保持し、形式を戻すと対応する失敗を表示する", () => {
  const f = fixture();
  const pdfWork = work(f.selected);
  const pngWork = work(f.selected, "png");
  f.pdf.pending = pdfWork;
  f.archive.pending = pngWork;
  f.session.setIncludeSourcePage(true);
  assert.equal(f.session.selectionChanged(), false);
  assert.equal(f.session.state.view.pending, pdfWork);
  f.session.setFormat("jpg");
  assert.equal(f.session.selectionChanged(), false);
  assert.equal(f.session.state.view.phase, "ready");
  assert.equal(f.archive.pending, pngWork);
  f.session.setFormat("png");
  assert.equal(f.session.state.view.pending, pngWork);
  f.session.setFormat("pdf");
  assert.equal(f.session.state.view.pending, pdfWork);
});

test("保存成功は明示通知と開始時の対象・形式・出典設定で記録し、元へ戻したときだけ再表示する", async () => {
  const f = fixture();
  let finish;
  f.pdf.task = async () => { await new Promise(resolve => { finish = resolve; }); f.session.complete(); };
  const original = f.selected;
  const execution = f.session.start();
  assert.equal(f.session.state.view.phase, "running");
  assert.deepEqual(f.calls, [["pdf", "export", undefined]]);
  await f.session.start();
  assert.equal(f.calls.length, 1, "進行中の保存を重ねて開始しない");
  f.session.setFormat("png");
  f.session.setIncludeSourcePage(true);
  f.selected = [image("new")];
  finish();
  await execution;
  assert.equal(f.session.state.view.phase, "ready");
  f.session.setFormat("pdf");
  f.selected = original;
  assert.equal(f.session.state.view.phase, "ready", "PDF出典設定が違う間は保存済みにしない");
  f.session.setIncludeSourcePage(false);
  assert.equal(f.session.state.view.phase, "saved");
  f.selected = [...original].reverse();
  f.session.selectionChanged();
  assert.equal(f.session.state.view.phase, "ready");
  f.selected = original;
  assert.equal(f.session.state.view.phase, "saved", "準備の破棄を伴わない一時的な選択変更から戻せる");
  f.session.invalidateCompletion();
  assert.equal(f.session.state.view.phase, "ready", "再解析開始などの明示イベントで完了を解除する");
});

test("完了通知のない終了は保存済みにせず、空の対象では処理を開始しない", async () => {
  const f = fixture();
  f.session.complete();
  assert.equal(f.session.state.view.phase, "ready");
  await f.session.start();
  assert.equal(f.session.state.view.phase, "ready");
  f.selected = [];
  await f.session.start();
  assert.deepEqual(f.calls, [["pdf", "export", undefined]]);
  assert.equal(f.session.state.view.phase, "empty");
});

test("媒体ごとの対象で保存し、画像保存後の出典設定変更は完了表示へ影響しない", async () => {
  const f = fixture();
  const movie = {...image("movie"), kind:"video"};
  f.selected = [...f.selected, movie];
  f.session.setFormat("mp4");
  assert.deepEqual(f.session.selectedItems, [movie]);
  f.archive.task = async () => { f.session.complete(); };
  await f.session.start();
  assert.deepEqual(f.calls, [["image", "export", "mp4"]]);
  assert.equal(f.session.state.view.phase, "saved");
  f.session.setIncludeSourcePage(true);
  assert.equal(f.session.state.view.phase, "saved");
  f.session.clear();
  assert.equal(f.session.state.view.phase, "ready");
  assert.deepEqual(f.calls.slice(-2), [["pdf", "clear"], ["image", "clear"]]);
});

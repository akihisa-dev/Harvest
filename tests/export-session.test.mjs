import assert from "node:assert/strict";
import test from "node:test";
import {createExportLifecycle} from "../dist/extension/app/export-lifecycle.js";
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

test("同じ形式・対象・出典設定の変更では再試行を保ち、別形式へ変えると準備を解放する", () => {
  const f = fixture();
  const pdfWork = work(f.selected);
  f.pdf.pending = pdfWork;
  f.session.setIncludeSourcePage(true);
  f.session.setFormat("pdf");
  assert.equal(f.session.selectionChanged(), false);
  assert.equal(f.session.state.view.pending, pdfWork);
  f.session.setFormat("png");
  assert.equal(f.pdf.pending, null);
  const pngWork = work(f.selected, "png");
  f.archive.pending = pngWork;
  f.session.setFormat("png");
  assert.equal(f.archive.pending, pngWork);
  f.session.setFormat("jpg");
  assert.equal(f.archive.pending, null);
  f.session.setFormat("pdf");
  assert.equal(f.session.state.view.phase, "ready");
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

for (const archiveFormat of ["png", "jpg", "jxl"]) {
  for (const [first, next] of [[archiveFormat, "pdf"], ["pdf", archiveFormat]]) {
    test(`${first}の失敗後に${next}へ切り替えると実際の保存処理の準備参照を解放する`, async () => {
      const selected = [image("one"), image("two")];
      let busy = false;
      let shouldFail = true;
      let session;
      let preparedCount = 0;
      let retried = false;
      const port = kind => {
        const lifecycle = createExportLifecycle({
          cancelledMessage:"cancelled", isBusy:() => busy, isDisposed:() => false,
          onBusyChange:value => { busy = value; }, onStatus() {}, onScrollToFailures() {},
        });
        return {
          get pending() { return lifecycle.pending; },
          get isRunning() { return lifecycle.isRunning; }, get progress() { return lifecycle.progress; },
          clear:() => lifecycle.clear(), abort:() => lifecycle.abort(),
          discardIfSelectionChanged:items => lifecycle.discardIfSelectionChanged(items),
          async export(format) {
            const other = kind === "pdf" ? archive : pdf;
            assert.equal(other.pending, null, "新形式の準備前に旧形式の参照を解放する");
            const work = lifecycle.resolveWork(selected, () => ({selected, format, prepared:new Map(), failed:new Map()}));
            await lifecycle.run(work, "start", "", async run => {
              retried = run.retry;
              for (const item of selected) {
                if (work.prepared.has(item)) continue;
                if (shouldFail && item === selected[1]) work.failed.set(item, "failed");
                else { work.prepared.set(item, new Blob([new Uint8Array(1024 * 1024)])); work.failed.delete(item); preparedCount++; }
              }
              if (!work.failed.size) { lifecycle.clear(); session.complete(); }
            });
          },
        };
      };
      const pdf = port("pdf"), archive = port("image");
      session = createExportSession({format:first, includeSourcePage:true, getSelectedItems:() => selected, getPdfController:() => pdf, getImageController:() => archive, isBusy:() => busy});
      await session.start();
      const old = first === "pdf" ? pdf : archive;
      assert.equal(old.pending.prepared.size, 1);
      session.setFormat(first);
      await session.start();
      assert.equal(retried, true);
      assert.equal(preparedCount, 1, "同じ形式の再試行では成功済みを再取得しない");
      session.setFormat(next);
      assert.equal(old.pending, null);
      assert.deepEqual(session.selectedItems, selected);
      assert.equal(session.includeSourcePage, true);
      shouldFail = false;
      await session.start();
      assert.equal(preparedCount, 3);
      assert.equal(pdf.pending, null);
      assert.equal(archive.pending, null);
      assert.equal(session.state.view.phase, "saved");
    });
  }
}

import assert from "node:assert/strict";
import test from "node:test";
import {createExportLifecycle} from "../dist/extension/app/panel/export-lifecycle.js";
import {createExportOperation} from "../dist/extension/app/panel/export-operation.js";

function setup() {
  let disposed = false;
  const busy = [];
  const statuses = [];
  const lifecycle = createExportLifecycle({
    cancelledMessage: "cancelled",
    isBusy: () => false,
    isDisposed: () => disposed,
    onBusyChange: value => busy.push(value),
    onStatus: (...args) => statuses.push(args),
    onScrollToFailures() {},
  });
  const work = () => ({selected: [], prepared: new Map(), failed: new Map()});
  return {lifecycle, busy, statuses, work, set disposed(value) { disposed = value; }};
}

test("保存操作は再試行で準備済み画像を再利用し、同じ順序で一度の完了を公開する", async () => {
  const images = ["a", "b"].map(name => ({url: `https://example.test/${name}.png`, selected: true}));
  const events = [];
  const attempts = [];
  const operation = createExportOperation({
    getSelectedItems: () => images,
    isBusy: () => false,
    isDisposed: () => false,
    onBusyChange: busy => events.push(["busy", busy]),
    onStatus: (message, state, progress) => events.push(["status", state, progress]),
    onCloseViewer() {},
    onScrollToFailures: () => events.push(["failures"]),
    onClearSourceUrl() {
      assert.notEqual(operation.pending, null, "URL表示を消す時点では保存対象が参照できる");
      events.push(["clear-source"]);
    },
    onCompleted() {
      assert.equal(operation.pending, null, "保存完了の表示前に再試行状態を解放する");
      events.push(["completed"]);
    },
  });
  const request = {
    createWork: selected => ({selected, prepared: new Map(), failed: new Map()}),
    preparationMessage: (retry, completed, total) => `${retry ? "retry" : "prepare"} ${completed}/${total}`,
    async run(attempt) {
      attempts.push({retry: attempt.retry, remaining: [...attempt.remaining]});
      if (!attempt.retry) {
        attempt.work.prepared.set(images[0], new Blob(["first"]));
        attempt.work.failed.set(images[1], "read failed");
        attempt.reportPreparation(2, 2);
        return;
      }
      assert.equal(await attempt.work.prepared.get(images[0]).text(), "first");
      attempt.work.failed.clear();
      attempt.work.prepared.set(images[1], new Blob(["second"]));
      attempt.reportPreparation(1, 1);
      attempt.complete();
    },
  };
  await operation.start(request);
  assert.deepEqual(events.at(-1), ["failures"]);
  await operation.start(request);
  assert.deepEqual(attempts, [{retry: false, remaining: images}, {retry: true, remaining: [images[1]]}]);
  assert.deepEqual(events.slice(-4), [["clear-source"], ["completed"], ["status", "success", ""], ["busy", false]]);
  assert.equal(operation.pending, null);
  assert.equal(operation.progress, "");
});

test("保存操作の中止後は遅い準備通知や完了通知を反映せず次の保存へ影響させない", async () => {
  const statuses = [];
  let completed = 0;
  let clearSource = 0;
  let finish;
  let firstAttempt;
  let selectionReads = 0;
  const operation = createExportOperation({
    getSelectedItems() { selectionReads++; return [{url: "https://example.test/a.png", selected: true}]; },
    isBusy: () => false,
    isDisposed: () => false,
    onBusyChange() {}, onCloseViewer() {}, onScrollToFailures() {},
    onStatus: (message, state, progress) => statuses.push([message, state, progress]),
    onClearSourceUrl: () => { clearSource++; },
    onCompleted: () => { completed++; },
  });
  const request = {
    createWork: selected => ({selected, prepared: new Map(), failed: new Map()}),
    preparationMessage: (_retry, done, total) => `prepare ${done}/${total}`,
    async run(attempt) {
      firstAttempt = attempt;
      await new Promise(resolve => { finish = resolve; });
      attempt.reportPreparation(1, 1);
      attempt.complete();
    },
  };
  const execution = operation.start(request);
  await operation.start(request);
  assert.equal(selectionReads, 1, "重複開始では新たな選択を読まない");
  operation.abort();
  finish();
  await execution;
  assert.equal(completed, 0);
  assert.equal(clearSource, 0);
  assert.equal(operation.pending, null);
  assert.deepEqual(statuses.map(([, state]) => state), ["busy", "info"]);
  await operation.start({...request, async run(attempt) {
    firstAttempt.reportPreparation(9, 9);
    firstAttempt.complete();
    assert.equal(operation.progress, "0 / 1");
    attempt.complete();
  }});
  assert.equal(completed, 1);
  assert.equal(clearSource, 1);
});

test("保存lifecycle自身が多重開始を拒否し、完了済みrunは進捗を上書きしない", async () => {
  const fixture = setup();
  let finish;
  let oldRun;
  const work = fixture.work();
  const execution = fixture.lifecycle.run(work, "first", "1", async run => {
    oldRun = run;
    await new Promise(resolve => { finish = resolve; });
  });
  let called = false;
  await fixture.lifecycle.run(fixture.work(), "duplicate", "bad", async () => { called = true; });
  assert.equal(called, false);
  assert.equal(fixture.lifecycle.pending, work);
  assert.equal(fixture.lifecycle.progress, "1");
  finish();
  await execution;
  assert.equal(oldRun.stopped, true);
  oldRun.reportStatus("late", "busy", "99");
  assert.equal(fixture.lifecycle.progress, "");
  assert.deepEqual(fixture.busy, [true, false]);
  assert.deepEqual(fixture.statuses, [["first", "busy", "1"]]);
  await fixture.lifecycle.run(fixture.work(), "second", "2", async run => {
    oldRun.reportStatus("old", "busy", "99");
    assert.equal(fixture.lifecycle.progress, "2");
    run.reportStatus("current", "busy", "3");
    assert.equal(fixture.lifecycle.progress, "3");
  });
  assert.deepEqual(fixture.statuses.at(-1), ["current", "busy", "3"]);
});

for (const action of ["abort", "dispose"]) {
  test(`${action}後の進捗通知を無視し、終了時の所有状態を解放する`, async () => {
    const fixture = setup();
    let finish;
    let activeRun;
    const work = fixture.work();
    work.prepared.set("image", new Blob(["content"]));
    const execution = fixture.lifecycle.run(work, "start", "1", async run => {
      activeRun = run;
      await new Promise(resolve => { finish = resolve; });
    });
    if (action === "abort") fixture.lifecycle.abort();
    else fixture.disposed = true;
    assert.equal(activeRun.stopped, true);
    activeRun.reportStatus("late", "busy", "99");
    assert.deepEqual(fixture.statuses, [["start", "busy", "1"]]);
    finish();
    await execution;
    assert.equal(fixture.lifecycle.isRunning, false);
    assert.equal(fixture.lifecycle.progress, "");
    if (action === "abort") {
      assert.equal(work.prepared.size, 0);
      assert.equal(fixture.lifecycle.pending, null);
      assert.deepEqual(fixture.statuses.at(-1), ["cancelled", "info", ""]);
    } else {
      let called = false;
      await fixture.lifecycle.run(fixture.work(), "disposed", "", async () => { called = true; });
      assert.equal(called, false);
      assert.deepEqual(fixture.busy, [true]);
    }
  });
}

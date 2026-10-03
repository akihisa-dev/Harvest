import assert from "node:assert/strict";
import test from "node:test";
import {createExportLifecycle} from "../dist/extension/app/panel/export-lifecycle.js";

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

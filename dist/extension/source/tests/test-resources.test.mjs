import assert from "node:assert/strict";
import test from "node:test";
import {ResourceScope, resourcesFor} from "./support/resources.mjs";

test("resource disposal runs in reverse acquisition order and only once", async () => {
  const scope = new ResourceScope(), order = [];
  scope.defer(() => order.push("temporary files"));
  scope.defer(async () => { await Promise.resolve(); order.push("server"); });
  scope.defer(() => order.push("browser"));
  await Promise.all([scope.close(), scope.close()]);
  assert.deepEqual(order, ["browser", "server", "temporary files"]);
  assert.throws(() => scope.defer(() => {}), /already closing/);
});

test("a failed cleanup still releases every remaining resource and reports all failures", async () => {
  const scope = new ResourceScope(), order = [], first = new Error("first"), second = new Error("second");
  scope.defer(() => order.push("files"));
  scope.defer(() => { throw first; });
  scope.defer(() => { throw second; });
  await assert.rejects(scope.close(), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [second, first]);
    return true;
  });
  assert.deepEqual(order, ["files"]);
});

test("resources belong to individual test contexts and register one teardown", async () => {
  const hooks = [], t = {after: hook => hooks.push(hook)}, another = {after() {}};
  assert.equal(resourcesFor(t), resourcesFor(t));
  assert.notEqual(resourcesFor(t), resourcesFor(another));
  assert.equal(hooks.length, 1);
  await hooks[0]();
});

test("teardown waits for an in-flight acquisition and releases its late resource", async () => {
  const scope = new ResourceScope();
  let finish, released = 0;
  const pending = scope.acquire(() => new Promise(resolve => { finish = resolve; }), () => { released++; });
  await Promise.resolve();
  const rejected = assert.rejects(pending, /closed during acquisition/);
  const closing = scope.close();
  finish({});
  await Promise.all([rejected, closing]);
  assert.equal(released, 1);
  await scope.close();
  assert.equal(released, 1);
});

test("failed acquisition does not hide its error or prevent other cleanup", async () => {
  const scope = new ResourceScope();
  let released = 0;
  scope.defer(() => { released++; });
  await assert.rejects(scope.acquire(() => { throw new Error("launch failed"); }, () => assert.fail("nothing acquired")), /launch failed/);
  await scope.close();
  assert.equal(released, 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  isJxlEncodeRequest, isJxlEncodeReply, isMp4ConversionRequest, isMp4ConversionReply,
  isZipChecksumRequest, isZipChecksumReply,
} from "../dist/extension/app/contracts/worker-contracts.js";
import {encodeJxl} from "../dist/extension/app/media/jxl-encoder.js";
import {prepareMp4} from "../dist/extension/app/media/mp4-conversion.js";
import {createStoredZipInWorker} from "../dist/extension/app/media/stored-zip-worker.js";

const webm = new Blob(["input"], {type: "video/webm"});
const mp4 = new Blob(["output"], {type: "video/mp4"});

test("Workerの両端は型・結果と失敗の混在・数値範囲を検証する", () => {
  const guards = [isJxlEncodeRequest, isJxlEncodeReply, isMp4ConversionRequest, isMp4ConversionReply, isZipChecksumRequest, isZipChecksumReply];
  for (const guard of guards) for (const value of [null, undefined, [], 1, "data", {}]) assert.equal(guard(value), false);
  assert.equal(isJxlEncodeRequest({id: 1, pixels: new ArrayBuffer(4), width: 1, height: 1}), true);
  assert.equal(isJxlEncodeRequest({id: 1, pixels: new ArrayBuffer(3), width: 1, height: 1}), false);
  assert.equal(isJxlEncodeRequest({id: 1, pixels: new ArrayBuffer(4), width: -1, height: -1}), false);
  assert.equal(isJxlEncodeReply({id: 1, buffer: new ArrayBuffer(1)}), true);
  assert.equal(isJxlEncodeReply({id: 1, buffer: new ArrayBuffer(1), error: "failure"}), false);
  assert.equal(isJxlEncodeReply({id: NaN, error: "failure"}), false);
  assert.equal(isMp4ConversionRequest({blob: webm, maxBytes: 10}), true);
  assert.equal(isMp4ConversionRequest({blob: mp4, maxBytes: 10}), false);
  assert.equal(isMp4ConversionRequest({blob: webm, maxBytes: Infinity}), false);
  assert.equal(isMp4ConversionReply({blob: mp4}), true);
  assert.equal(isMp4ConversionReply({blob: mp4, error: "failure"}), false);
  assert.equal(isZipChecksumRequest({id: 1, blob: new Blob()}), true);
  for (const checksum of [0, 0xffff_ffff]) assert.equal(isZipChecksumReply({id: 1, checksum}), true);
  for (const checksum of [-1, NaN, 1.1, 0x1_0000_0000, "12"]) assert.equal(isZipChecksumReply({id: 1, checksum}), false);
  for (const guard of [isJxlEncodeReply, isZipChecksumReply]) assert.equal(guard({id: 1, error: "failure"}), true);
});

test("JXLは未完了要求をidle扱いせず、不正な応答で全要求を解放する", async () => {
  const previous = {Worker: globalThis.Worker, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout};
  let worker, timers = 0;
  globalThis.Worker = class {
    requests = [];
    constructor() { worker = this; }
    postMessage(request) { this.requests.push(request); }
    terminate() { this.terminated = true; }
  };
  globalThis.setTimeout = () => ++timers;
  globalThis.clearTimeout = () => {};
  try {
    const image = () => ({width: 1, height: 1, data: new Uint8ClampedArray(4)});
    const first = encodeJxl(image());
    const second = encodeJxl(image());
    worker.onmessage({data: {id: worker.requests[0].id, buffer: new ArrayBuffer(1)}});
    await first;
    assert.equal(timers, 0);
    worker.onmessage({data: null});
    await assert.rejects(second, /読み取れません/);
    assert.equal(worker.terminated, true);
    const oldWorker = worker;
    const retry = encodeJxl(image());
    oldWorker.onerror();
    oldWorker.onmessage({data: null});
    assert.equal(worker.terminated, undefined);
    worker.onmessage({data: null});
    await assert.rejects(retry, /読み取れません/);
  } finally { Object.assign(globalThis, previous); }
});

test("MP4は不正・容量超過の応答を拒否してWorkerを終了する", async () => {
  const previous = globalThis.Worker;
  let worker;
  globalThis.Worker = class {
    constructor() { worker = this; }
    postMessage() {}
    terminate() { this.terminated = true; }
  };
  try {
    for (const data of [null, {blob: mp4}]) {
      const result = prepareMp4(webm, undefined, 1);
      worker.onmessage({data});
      await assert.rejects(result);
      assert.equal(worker.terminated, true);
    }
  } finally { globalThis.Worker = previous; }
});

test("ZIPはmessageerror・送信失敗・不正CRCで待機とlistenerを解放する", async () => {
  const previous = globalThis.Worker;
  let worker, mode;
  globalThis.Worker = class extends EventTarget {
    listeners = new Set();
    constructor() { super(); worker = this; }
    addEventListener(type, fn, options) { this.listeners.add(type); super.addEventListener(type, fn, options); }
    removeEventListener(type, fn) { this.listeners.delete(type); super.removeEventListener(type, fn); }
    postMessage(request) {
      if (mode === "send") throw new Error("clone failed");
      queueMicrotask(() => this.dispatchEvent(mode === "decode" ? new Event("messageerror")
        : new MessageEvent("message", {data: {id: request.id, checksum: -1}})));
    }
    terminate() { this.terminated = true; }
  };
  try {
    for (mode of ["send", "decode", "invalid"]) {
      await assert.rejects(createStoredZipInWorker([{filename: "a.txt", blob: new Blob(["a"])}]), /CRC/);
      assert.equal(worker.terminated, true);
      assert.equal(worker.listeners.size, 0);
    }
  } finally { globalThis.Worker = previous; }
});


test("JXLの送信失敗は最後の要求ならWorkerを解放し、実行中の別要求は完了できる", async () => {
  const previous = {Worker: globalThis.Worker, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout};
  let worker, failSend = true, idle;
  const workers = [];
  globalThis.Worker = class {
    requests = [];
    constructor() { worker = this; workers.push(this); }
    postMessage(request) {
      if (failSend) throw new DOMException("clone failed", "DataCloneError");
      this.requests.push(request);
    }
    terminate() { this.terminated = true; }
  };
  globalThis.setTimeout = callback => { idle = callback; return 1; };
  globalThis.clearTimeout = () => { idle = undefined; };
  try {
    const image = () => ({width: 1, height: 1, data: new Uint8ClampedArray(4)});
    await assert.rejects(encodeJxl(image()), {name: "DataCloneError"});
    assert.equal(worker.terminated, true);
    assert.equal(idle, undefined);

    failSend = false;
    const pending = encodeJxl(image());
    assert.equal(workers.length, 2);
    failSend = true;
    await assert.rejects(encodeJxl(image()), {name: "DataCloneError"});
    assert.equal(worker.terminated, undefined);
    const buffer = new ArrayBuffer(1);
    worker.onmessage({data: {id: worker.requests[0].id, buffer}});
    assert.equal(await pending, buffer);
    assert.equal(typeof idle, "function");
    idle();
    assert.equal(worker.terminated, true);
  } finally { Object.assign(globalThis, previous); }
});

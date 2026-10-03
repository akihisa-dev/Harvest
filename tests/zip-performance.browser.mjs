import {extensionFile} from "./support/extension-files.mjs";
import {startServer, launchBrowser} from "./support/browser.mjs";
import assert from "node:assert/strict";
import test from "node:test";

async function serve(t) {
  const server = await startServer(t, async (request, response) => {
    if (request.url === "/") {
      response.writeHead(200, {"Content-Type": "text/html; charset=utf-8"}).end("<!doctype html><title>ZIP worker test</title>");
      return;
    }
    try {
      const file = await extensionFile(new URL(request.url, "http://localhost").pathname);
      response.writeHead(200, {"Content-Type": file.contentType});
      response.end(file.body);
    } catch { response.writeHead(404).end(); }
  });

  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}/`,
  };
}

test("ZIPのworker CRC32と格納データを確認し、中止時にworkerを終了する", async (t) => {
  const fixture = await serve(t);
  const browser = await launchBrowser(t);
  const page = await browser.newPage();
  await page.goto(fixture.url);
  const result = await page.evaluate(async () => {
    const nativeWorker = window.Worker;
    window.__workers = [];
    window.__terminatedWorkers = 0;
    window.__holdChecksum = false;
    window.Worker = class extends nativeWorker {
      constructor(...args) {
        super(...args);
        window.__workers.push(this);
      }
      postMessage(message, transfer) {
        if (!window.__holdChecksum) return super.postMessage(message, transfer);
      }
      terminate() {
        window.__terminatedWorkers += 1;
        super.terminate();
      }
    };
    const {createStoredZipInWorker} = await import("/app/media/stored-zip-worker.js");
    const bytes = new TextEncoder().encode("123456789");
    const archive = await createStoredZipInWorker([{filename: "vector.bin", blob: new Blob([bytes])}]);
    const contents = new Uint8Array(await archive.arrayBuffer());
    const view = new DataView(contents.buffer);
    const crc32 = view.getUint32(14, true);
    const filenameLength = view.getUint16(26, true);
    const payload = [...contents.slice(30 + filenameLength, 30 + filenameLength + bytes.length)];
    window.__holdChecksum = true;
    const controller = new AbortController();
    const cancelled = createStoredZipInWorker([{filename: "cancel.bin", blob: new Blob([new Uint8Array(1024)])}], {signal: controller.signal})
      .then(() => ({resolved: true}), error => ({name: error.name}));
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    const cancellation = await cancelled;
    return {
      crc32,
      payload,
      expectedPayload: [...bytes],
      cancellation,
      createdWorkers: window.__workers.length,
      terminatedWorkers: window.__terminatedWorkers
    };
  });
  assert.equal(result.crc32, 0xcbf43926, "CRC32('123456789') matches the standard check value");
  assert.deepEqual(result.payload, result.expectedPayload, "ZIP stores the source payload byte-for-byte");
  assert.deepEqual(result.cancellation, {name: "AbortError"});
  assert.equal(result.createdWorkers, 2);
  assert.equal(result.terminatedWorkers, 2, "worker is terminated after success and cancellation");
});

test("大容量ZIPのCRC計算中も画面側のタイマーが動き続ける", async (t) => {
  const fixture = await serve(t);
  const browser = await launchBrowser(t);
  const page = await browser.newPage();
  await page.goto(fixture.url);
  const result = await page.evaluate(async () => {
    const {createStoredZipInWorker} = await import("/app/media/stored-zip-worker.js");
    const megabyte = new Uint8Array(1024 * 1024).fill(0x5a);
    const blob = new Blob(Array.from({length: 96}, () => megabyte));
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 10);
    const started = performance.now();
    try {
      const archive = await createStoredZipInWorker([{filename: "large.bin", blob}]);
      return {ticks, elapsed: performance.now() - started, size: archive.size};
    } finally {
      clearInterval(timer);
    }
  });
  assert.ok(result.ticks >= 2, `画面タイマーが${result.ticks}回しか動きませんでした (${result.elapsed.toFixed(0)} ms)`);
  assert.ok(result.size > 96 * 1024 * 1024);
  console.log(`96 MiB CRC/ZIP: ${result.elapsed.toFixed(0)} ms; UI timer ticks: ${result.ticks}`);
});

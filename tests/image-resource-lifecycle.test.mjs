import assert from "node:assert/strict";
import test from "node:test";
import {decodeImage} from "../dist/extension/app/media/image-decode.js";
import {convertImage} from "../dist/extension/app/media/image-format.js";
import {fetchImage} from "../dist/extension/app/media/image-fetch.js";
import {baselineJpeg} from "./jpeg-fixtures.mjs";

const fetched = () => ({kind: "bitmap", blob: new Blob(["pixels"], {type: "image/webp"}), dimensions: null});
const conversions = [
  {name: "PDF", run: (source, signal) => decodeImage(source, {signal})},
  ...["jpg", "png", "jxl"].map(format => ({name: format, run: (source, signal) => convertImage(source, format, signal)})),
];

test("全画像変換はCanvasの確保・描画・画素取得に失敗しても確保済み画素を解放する", async t => {
  const previous = {document: globalThis.document, createImageBitmap: globalThis.createImageBitmap};
  t.after(() => Object.assign(globalThis, previous));
  for (const conversion of conversions) {
    for (const failure of ["allocation", "context", "draw", "pixels"]) {
      if (failure === "pixels" && ["jpg", "png"].includes(conversion.name)) continue;
      let closed = 0;
      let created;
      globalThis.createImageBitmap = async () => ({width: 2, height: 1, close() { closed += 1; }});
      globalThis.document = {createElement() {
        if (failure === "allocation") throw new Error("allocation failed");
        created = {
          width: 0, height: 0,
          getContext() {
            if (failure === "context") return null;
            return {
              fillRect() {},
              drawImage() { if (failure === "draw") throw new Error("drawing failed"); },
              getImageData() { throw new Error("pixels failed"); },
            };
          },
        };
        return created;
      }};
      await assert.rejects(conversion.run(fetched()));
      assert.equal(closed, 1, `${conversion.name}/${failure}: bitmap released exactly once`);
      if (created) assert.deepEqual([created.width, created.height], [0, 0]);
    }
  }
});

test("画像の非同期符号化が終了するまでは画素を保持し、失敗時にも元の順で解放する", async t => {
  const previous = {document: globalThis.document, createImageBitmap: globalThis.createImageBitmap};
  t.after(() => Object.assign(globalThis, previous));
  for (const format of ["jpg", "png"]) for (const success of [true, false]) {
    const releases = [];
    let complete;
    let width = 0, height = 0;
    globalThis.createImageBitmap = async () => ({width: 2, height: 1, close() { releases.push("bitmap"); }});
    globalThis.document = {createElement: () => ({
      get width() { return width; }, set width(value) { width = value; if (!value) releases.push("width"); },
      get height() { return height; }, set height(value) { height = value; if (!value) releases.push("height"); },
      getContext: () => ({fillRect() {}, drawImage() {}}),
      toBlob(callback) { complete = callback; },
    })};
    const result = convertImage(fetched(), format);
    const settled = success ? result : assert.rejects(result, /画像を変換できませんでした/);
    for (let attempt = 0; !complete && attempt < 100; attempt += 1) await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof complete, "function");
    assert.deepEqual(releases, []);
    assert.deepEqual([width, height], [2, 1]);
    complete(success ? new Blob(["encoded"]) : null);
    await settled;
    assert.deepEqual(releases, ["bitmap", "width", "height"]);
  }
});

test("デコード失敗と中止が重なった場合のPDFと画像保存の既存の優先順位を維持する", async t => {
  const previous = globalThis.createImageBitmap;
  t.after(() => { globalThis.createImageBitmap = previous; });
  for (const conversion of conversions) {
    const controller = new AbortController();
    globalThis.createImageBitmap = async () => {
      controller.abort();
      throw new Error("decode failed");
    };
    await assert.rejects(conversion.run(fetched(), controller.signal), error =>
      error.kind === (conversion.name === "PDF" ? "invalid-image" : "cancelled"));
  }
});

test("JPEG原本の取得時にデコード寸法が食い違ってもbitmapを解放する", async t => {
  const previous = {fetch: globalThis.fetch, createImageBitmap: globalThis.createImageBitmap};
  t.after(() => Object.assign(globalThis, previous));
  let closed = 0;
  globalThis.fetch = async () => new Response(baselineJpeg, {headers: {"content-type": "image/jpeg"}});
  globalThis.createImageBitmap = async () => ({width: 100, height: 100, close() { closed += 1; }});
  await assert.rejects(fetchImage("https://image.test/original.jpg", {}), error =>
    error.kind === "invalid-image" && error.message === "画像の大きさが不正です。");
  assert.equal(closed, 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import {inflateSync} from "node:zlib";
import {animationPanel} from "./support/animation-panel.mjs";
import {decodeJxl} from "./support/jxl-decoder.mjs";

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="red"/></svg>';

test("正常SVGを実拡張からPDF・JPG・PNG・JXLへ保存し寸法と赤い画素を保持する", {timeout:90_000}, async t => {
  const assets = new Map([["/uploads/photo.svg", [Buffer.from(svg), "image/svg+xml"]]]);
  const {page, scan, saved} = await animationPanel(t, assets);
  await scan(["/uploads/photo.svg"], "svg");
  for (const format of ["pdf", "jpg", "png", "jxl"]) {
    const {bytes, filename} = await saved(format);
    assert.ok(filename.endsWith(`.${format}`));
    if (format === "pdf") {
      const text = bytes.toString("latin1");
      const image = /\/Subtype \/Image\b[\s\S]*?\/Width 32\b[\s\S]*?\/Height 24\b[\s\S]*?\/Length (\d+)[\s\S]*?stream\n/.exec(text);
      assert.ok(image, "PDF contains the original image dimensions");
      const start = image.index + image[0].length;
      const rgb = inflateSync(bytes.subarray(start, start + Number(image[1])));
      assert.deepEqual(rgb, Buffer.from(Array.from({length:32*24}, () => [255,0,0]).flat()));
    } else {
      const pixels = format === "jxl" ? await decodeJxl(bytes) : await page.evaluate(async ({bytes, format}) => {
        const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], {type:format === "jpg" ? "image/jpeg" : "image/png"}));
        try {
          const canvas = new OffscreenCanvas(image.width, image.height), ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0);
          return {width:image.width, height:image.height, data:[...ctx.getImageData(0,0,image.width,image.height).data]};
        } finally { image.close(); }
      }, {bytes:[...bytes], format});
      assert.deepEqual([pixels.width, pixels.height], [32,24]);
      for (let i=0; i<pixels.data.length; i+=4) {
        const actual = [...pixels.data.slice(i,i+4)];
        if (format === "jpg") assert.ok(actual[0] >= 253 && actual[1] <= 2 && actual[2] <= 2 && actual[3] === 255);
        else assert.deepEqual(actual, [255,0,0,255]);
      }
    }
  }
});

test("SVG変換は外部資源とスクリプトを読み込まず巨大寸法を描画前に拒否する", {timeout:60_000}, async t => {
  const {page} = await animationPanel(t, new Map());
  const requests = [];
  page.on("request", request => { if (/\/forbidden/.test(request.url())) requests.push(request.url()); });
  const result = await page.evaluate(async () => {
    const {convertImage} = await import("./media/image-format.js");
    const markup = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24" onload="fetch(\'http://127.0.0.1:1/forbidden-script\')"><style>@import url("http://127.0.0.1:1/forbidden-style");</style><image href="http://127.0.0.1:1/forbidden-image" width="32" height="24"/><rect width="32" height="24" fill="red"/></svg>';
    const png = await convertImage({kind:"bitmap",blob:new Blob([markup],{type:"image/svg+xml"})}, "png");
    const image = await createImageBitmap(png), canvas = new OffscreenCanvas(32,24), ctx = canvas.getContext("2d");
    ctx.drawImage(image,0,0);image.close();
    const pixel = [...ctx.getImageData(0,0,1,1).data];
    let urls = 0;
    const original = URL.createObjectURL;
    URL.createObjectURL = function(...args) { urls++; return original.apply(this,args); };
    const errors = [];
    try {
      for (const size of ['width="16385" height="1"','width="8001" height="8000"']) {
        try { await convertImage({kind:"bitmap",blob:new Blob([`<svg xmlns="http://www.w3.org/2000/svg" ${size}/>`],{type:"image/svg+xml"})}, "png"); }
        catch (error) { errors.push(error.message); }
      }
    } finally { URL.createObjectURL = original; }
    return {pixel,urls,errors};
  });
  assert.deepEqual(result.pixel,[255,0,0,255]);
  assert.deepEqual(requests,[]);
  assert.equal(result.urls,0);
  assert.equal(result.errors.length,2);
  for (const error of result.errors) assert.match(error,/大きすぎる/);
});

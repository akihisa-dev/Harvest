import assert from "node:assert/strict";
import test from "node:test";
import {fetchImage} from "../dist/extension/app/image-fetch.js";
import {convertImage} from "../dist/extension/app/image-format.js";
import {toPdfPage} from "../dist/extension/app/pdf-image.js";
import {createImagePreviewLoader} from "../dist/extension/app/image-preview.js";

for (const [width,height] of [[16385,1],[8001,8000]]) {
  test(`SVG ${width}x${height}は各入口で展開前に拒否する`, async t => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"/>`;
    t.mock.method(globalThis, "fetch", async () => new Response(svg, {headers:{"content-type":"image/svg+xml"}}));
    let decodes = 0, urls = 0, srcSets = 0;
    const previous = globalThis.createImageBitmap;
    globalThis.createImageBitmap = async () => {decodes++; throw new Error("must not decode");};
    t.after(() => { if(previous === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap=previous; });
    t.mock.method(URL, "createObjectURL", () => {urls++; return "blob:test";});
    await assert.rejects(fetchImage("https://example.com/uploads/a.svg", {}), /大きすぎる/);
    await assert.rejects(toPdfPage("https://example.com/uploads/a.svg"), /大きすぎる/);
    for (const format of ["jpg","png","jxl"]) await assert.rejects(convertImage({kind:"bitmap",blob:new Blob([svg],{type:"image/svg+xml"})},format), /大きすぎる/);
    const image = {dataset:{},isConnected:true,loading:"",getAttribute(){return null;},removeAttribute(){},set src(value){srcSets++;}};
    const loader = createImagePreviewLoader();
    try {
      loader.set(image,{url:"https://example.com/uploads/a.svg",sourcePage:"https://example.com/page"},true);
      for(let i=0;i<100 && image.dataset.previewFailed!=="true";i++) await new Promise(r=>setTimeout(r,5));
      assert.equal(image.dataset.previewFailed,"true");
      assert.equal(decodes,0); assert.equal(urls,0); assert.equal(srcSets,0);
    } finally {loader.clear();}
  });
}
test("通常SVGは従来どおりBlobを返す", async t => {
 t.mock.method(globalThis,"fetch",async()=>new Response('<svg width="2" height="2"/>',{headers:{"content-type":"image/svg+xml"}}));
 const result=await fetchImage("https://example.com/uploads/a.svg",{});
 assert.deepEqual(result.dimensions,{width:2,height:2});assert.equal(result.blob.type,"image/svg+xml");
});

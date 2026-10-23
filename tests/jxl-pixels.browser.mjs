import assert from "node:assert/strict";
import test from "node:test";
import {animationPanel} from "./support/animation-panel.mjs";
import {decodeJxl} from "./support/jxl-decoder.mjs";

for (const alpha of [255,128]) test(`実Workerを通ったJXL保存結果の寸法と全RGBAが元PNGに一致する: alpha=${alpha}`, {timeout:60_000}, async t => {
  const assets = new Map();
  const {page,scan,saved} = await animationPanel(t,assets);
  // Saturated channels remain exact through Canvas premultiplication.
  const rgba = [255,0,0,255, 0,255,0,alpha, 0,0,255,alpha, 255,255,0,alpha, 0,255,255,255, 255,0,255,alpha];
  const input = await page.evaluate(rgba => {
    const canvas = document.createElement("canvas");canvas.width=3;canvas.height=2;
    canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba),3,2),0,0);
    return canvas.toDataURL("image/png").split(",")[1];
  },rgba);
  assets.set('/uploads/pixels.png',[Buffer.from(input,'base64'),'image/png']);
  await scan(['/uploads/pixels.png'],'pixels');
  const output = await saved('jxl');
  assert.ok(output.filename.endsWith('.jxl'));
  const decoded = await decodeJxl(output.bytes);
  assert.deepEqual([decoded.width,decoded.height],[3,2]);
  assert.deepEqual([...decoded.data],rgba,'saved JXL pixels must match the source, including alpha');
});

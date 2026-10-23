import assert from "node:assert/strict";
import test from "node:test";
import {inspectWebpAnimation} from "../dist/extension/core/webp-animation.js";
import {staticWebp, animatedWebp} from "./animation-fixtures.mjs";

function chunk(type, data) {
  const bytes = Buffer.alloc(8 + data.length + data.length % 2);
  bytes.write(type); bytes.writeUInt32LE(data.length,4); bytes.set(data,8);
  return bytes;
}
function container(type, payload, animated) {
  const image = chunk(type,payload);
  const content = animated ? Buffer.concat([
    chunk("VP8X",Buffer.from([2,0,0,0,0,0,0,0,0,0])),chunk("ANIM",Buffer.alloc(6)),
    chunk("ANMF",Buffer.concat([Buffer.alloc(16),image])),
  ]) : image;
  const header = Buffer.alloc(12); header.write("RIFF");header.writeUInt32LE(content.length+4,4);header.write("WEBP",8);
  return Buffer.concat([header,content]);
}

for (const animated of [false,true]) test(`WebP ${animated ? "ANMF内" : "静止"}の必須画像ヘッダーを検査する`, () => {
  const vp8 = Buffer.from([0x10,0,0,0x9d,1,0x2a,32,0,24,0]);
  const vp8l = Buffer.from([0x2f,31,0xc0,5,0]);
  for (const [type,header] of [["VP8 ",vp8],["VP8L",vp8l]]) {
    for (let length=0; length<header.length; length++) assert.equal(inspectWebpAnimation(container(type,header.subarray(0,length),animated)),"invalid",`${type}: ${length} bytes`);
    assert.equal(inspectWebpAnimation(container(type,header,animated)),animated ? "animated" : "static");
  }
  for (const [offset,value] of [[0,0x11],[0,0x18],[0,0],[3,0],[4,0],[5,0],[6,0],[8,0]]) {
    const invalid = Buffer.from(vp8);invalid[offset]=value;
    assert.equal(inspectWebpAnimation(container("VP8 ",invalid,animated)),"invalid");
  }
  for (const [offset,value] of [[0,0],[4,0x20],[4,0xe0]]) {
    const invalid = Buffer.from(vp8l);invalid[offset]=value;
    assert.equal(inspectWebpAnimation(container("VP8L",invalid,animated)),"invalid");
  }
});

test("正常な静止・アニメーションWebPを受理し入力を書き換えない", () => {
  for (const [bytes,kind] of [[staticWebp,"static"],[animatedWebp,"animated"]]) {
    const copy=Buffer.from(bytes);
    assert.equal(inspectWebpAnimation(bytes),kind);assert.deepEqual(bytes,copy);
    const prefixed=Buffer.concat([Buffer.from([1,2,3]),bytes]);
    assert.equal(inspectWebpAnimation(prefixed.subarray(3)),kind);
  }
  const multiple = Buffer.concat([staticWebp,chunk("VP8L",Buffer.from([0x2f]))]);
  multiple.writeUInt32LE(multiple.length-8,4);
  assert.equal(inspectWebpAnimation(multiple),"invalid","a valid earlier chunk must not mask a later invalid header");
});

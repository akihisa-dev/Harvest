import {readStoredZip, readStoredZipBytes} from "./support/stored-zip-reader.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import {createStoredZip, storedZipDataLimit} from "../dist/extension/core/stored-zip.js";


test("ZIP stores image blobs in order with intact bytes and valid CRC values", async () => {
  const first = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]);
  const second = new Uint8Array([0xff, 0xd8, 0x7f, 0xff, 0xd9]);
  const archive = await createStoredZip([
    {filename: "001.png", blob: new Blob([first], {type: "image/png"})},
    {filename: "002.jpg", blob: new Blob([second], {type: "image/jpeg"})},
  ]);
  assert.equal(archive.type, "application/zip");
  const entries = await readStoredZip(archive);
  assert.deepEqual(entries.map(entry => entry.name), ["001.png", "002.jpg"]);
  assert.deepEqual([...entries[0].data], [...first]);
  assert.deepEqual([...entries[1].data], [...second]);
});

test("empty ZIP is valid and unsafe or duplicate entry names are rejected", async () => {
  assert.deepEqual(await readStoredZip(await createStoredZip([])), []);
  await assert.rejects(createStoredZip([{filename: "../001.png", blob: new Blob(["x"])}]), RangeError);
  await assert.rejects(createStoredZip([
    {filename: "001.png", blob: new Blob(["x"])},
    {filename: "001.png", blob: new Blob(["y"])},
  ]), RangeError);
});

test("ZIP creation honors cancellation and the ZIP32 entry-count limit", async () => {
  const controller = new AbortController();
  const work = createStoredZip(Array.from({length: 20}, (_, index) => ({
    filename: `${String(index + 1).padStart(3, "0")}.jpg`,
    blob: new Blob(["x"]),
  })), {signal: controller.signal, onProgress(completed) { if (completed === 1) controller.abort(); } });
  await assert.rejects(work, error => error.name === "AbortError");
  const empty = new Blob();
  const tooManyEntries = Array.from({length: 65_536}, (_, index) => ({filename: `${index}.jpg`, blob: empty}));
  await assert.rejects(createStoredZip(tooManyEntries), RangeError);
});


test("ZIP budget reserves UTF-8 names and all headers and rejects overflow before reading data", async () => {
  const filenames = ["001.jpg", "画像.png"];
  const overhead = 22 + filenames.reduce((size, name) => size + 76 + 2 * new TextEncoder().encode(name).length, 0);
  assert.equal(storedZipDataLimit(filenames), 0xffff_ffff - overhead);
  const limit = storedZipDataLimit(["001.jpg"]);
  let reads = 0;
  await assert.rejects(createStoredZip([{
    filename: "001.jpg",
    blob: {
      size: limit + 1,
      stream() {
        reads += 1;
        throw new Error("must not read an oversized archive");
      },
    }
  }]), /ZIP全体/);
  assert.equal(reads, 0);
  assert.throws(() => storedZipDataLimit(Array(65_536).fill("001.jpg")), /画像数/);
});

test("日本語名と複数ファイルを中央ディレクトリから元の内容で読み戻す", async () => {
  const source = [{filename:"画像.png",bytes:Buffer.from([0,255,128,42])},{filename:"説明📷.txt",bytes:Buffer.from("保存した内容")},{filename:"空.txt",bytes:Buffer.alloc(0)}];
  const archive = await createStoredZip(source.map(item => ({filename:item.filename,blob:new Blob([item.bytes])})));
  const entries = await readStoredZip(archive);
  assert.deepEqual(entries.map(entry=>entry.name),source.map(item=>item.filename));
  entries.forEach((entry,i)=>assert.deepEqual(entry.bytes,source[i].bytes));
});

test("中央CRC・サイズ・方式・UTF-8名の破損を保存内容の読戻しが検出する", async () => {
  const bytes = Buffer.from(await (await createStoredZip([{filename:"画像.txt",blob:new Blob(["preserve payload"])}])).arrayBuffer());
  const central = bytes.readUInt32LE(bytes.length-6);
  for (const [field,offset,width,value] of [["CRC",16,4,0],["size",24,4,1],["method",10,2,8],["UTF-8 flag",8,2,0],["name",46,1,0xff],["offset",42,4,1]]) {
    const corrupt = Buffer.from(bytes);
    corrupt.writeUIntLE(value,central+offset,width);
    assert.throws(()=>readStoredZipBytes(corrupt),undefined,field);
  }
  const corrupt = Buffer.from(bytes);corrupt[30+bytes.readUInt16LE(26)] ^= 1;
  assert.throws(()=>readStoredZipBytes(corrupt),/actual file contents/);
});

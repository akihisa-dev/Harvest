import assert from "node:assert/strict";
import test from "node:test";
import { createStoredZip, storedZipDataLimit } from "../dist/extension/core/stored-zip.js";

function crc32(bytes) {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb8_8320 : crc >>> 1;
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

async function readStoredZip(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const entries = [];
  let offset = 0;
  while (view.getUint32(offset, true) === 0x0403_4b50) {
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const length = view.getUint32(offset + 22, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const dataStart = offset + 30 + nameLength + extraLength;
    const data = bytes.slice(dataStart, dataStart + length);
    entries.push({name, data, crc: view.getUint32(offset + 14, true), start: offset});
    offset = dataStart + length;
  }
  const directoryStart = offset;
  let directoryEntries = 0;
  while (view.getUint32(offset, true) === 0x0201_4b50) {
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    assert.equal(view.getUint32(offset + 42, true), entries[directoryEntries].start);
    assert.equal(name, entries[directoryEntries].name);
    offset += 46 + nameLength + extraLength + commentLength;
    directoryEntries += 1;
  }
  assert.equal(view.getUint32(offset, true), 0x0605_4b50);
  assert.equal(view.getUint16(offset + 10, true), entries.length);
  assert.equal(view.getUint32(offset + 12, true), offset - directoryStart);
  assert.equal(view.getUint32(offset + 16, true), directoryStart);
  assert.equal(offset + 22, bytes.length);
  for (const entry of entries) assert.equal(entry.crc, crc32(entry.data));
  return entries;
}

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
  })), {signal: controller.signal, onProgress(completed) { if (completed === 1) controller.abort(); }});
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
  await assert.rejects(createStoredZip([{filename: "001.jpg", blob: {
    size: limit + 1,
    stream() { reads += 1; throw new Error("must not read an oversized archive"); },
  }}]), /ZIP全体/);
  assert.equal(reads, 0);
  assert.throws(() => storedZipDataLimit(Array(65_536).fill("001.jpg")), /画像数/);
});

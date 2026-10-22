import assert from "node:assert/strict";
import test from "node:test";
import {crc32, updateCrc32} from "../dist/extension/core/crc32.js";
import {storedZipChecksum} from "../dist/extension/core/stored-zip.js";

// Deliberately independent bitwise reference, without lookup tables.
function reference(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

test("CRC32は既知値・8バイト境界・端数・部分配列で独立計算と一致する", () => {
  assert.equal(crc32(new Uint8Array()), 0);
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const bytes = new Uint8Array(65553);
  let seed = 1;
  for (let i = 0; i < bytes.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    bytes[i] = seed & 255;
  }
  const original = bytes.slice();
  for (let offset = 0; offset < 8; offset++) {
    for (const length of [...Array.from({length: 66}, (_, i) => i), 1023, 1024, 1025, 65535, 65536, 65537]) {
      const input = bytes.subarray(offset, offset + length);
      assert.equal(crc32(input), reference(input), `offset=${offset}, length=${length}`);
    }
  }
  assert.deepEqual(bytes, original, "検査しても入力バイトを変更しない");
});

test("CRC32は任意の分割読み取りとZIPのストリーム読み取りで同じ値を返す", async () => {
  const bytes = Uint8Array.from({length: 131077}, (_, i) => (i * 31 + (i >>> 8)) & 255);
  const expected = reference(bytes);
  for (const chunkSize of [1, 7, 8, 9, 31, 65535, 65536]) {
    let crc = 0xffffffff;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      crc = updateCrc32(crc, bytes.subarray(offset, offset + chunkSize));
      crc = updateCrc32(crc, new Uint8Array());
    }
    assert.equal((crc ^ 0xffffffff) >>> 0, expected, `chunkSize=${chunkSize}`);
  }
  assert.equal(await storedZipChecksum(new Blob([bytes])), expected);
});

import assert from "node:assert/strict";
import {gzipSync} from "node:zlib";

function crc32(bytes) {
  // Gzip's trailer carries zlib's CRC32, also on Node 22.0/22.1 where
  // the standalone zlib.crc32 API is unavailable. No product CRC code is used.
  const gzip = gzipSync(bytes, {level:0});
  return gzip.readUInt32LE(gzip.length-8);
}

/** Read Harvest's stored ZIP32 using the central directory and independent CRC32. */
export function readStoredZipBytes(input) {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  assert.ok(bytes.length >= 22, "ZIP end record exists");
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50, "ZIP end signature");
  assert.equal(bytes.readUInt16LE(end+4), 0, "single disk");
  assert.equal(bytes.readUInt16LE(end+6), 0);
  assert.equal(bytes.readUInt16LE(end+20), 0, "no archive comment");
  const count = bytes.readUInt16LE(end+10);
  assert.equal(bytes.readUInt16LE(end+8), count);
  const directoryStart = bytes.readUInt32LE(end+16);
  assert.equal(directoryStart+bytes.readUInt32LE(end+12), end, "directory bounds");
  const entries = [], names = new Set();
  let at = directoryStart, nextLocal = 0;
  for (let i=0; i<count; i++) {
    assert.ok(at+46 <= end, "central header bounds");
    assert.equal(bytes.readUInt32LE(at), 0x02014b50, "central signature");
    const flags = bytes.readUInt16LE(at+8), method = bytes.readUInt16LE(at+10);
    assert.equal(flags, 0x800, "UTF-8 names without encryption or data descriptors");
    assert.equal(method, 0, "stored compression method");
    assert.equal(bytes.readUInt16LE(at+34), 0, "entry belongs to disk zero");
    const crc = bytes.readUInt32LE(at+16), size = bytes.readUInt32LE(at+24);
    assert.equal(bytes.readUInt32LE(at+20), size, "stored sizes match");
    const nameLength = bytes.readUInt16LE(at+28), extraLength = bytes.readUInt16LE(at+30), commentLength = bytes.readUInt16LE(at+32);
    const next = at+46+nameLength+extraLength+commentLength;
    assert.ok(next <= end, "central name and extra bounds");
    const nameBytes = bytes.subarray(at+46,at+46+nameLength);
    const name = new TextDecoder("utf-8", {fatal:true}).decode(nameBytes);
    assert.ok(name && !names.has(name), "unique nonempty names");names.add(name);
    const local = bytes.readUInt32LE(at+42);
    assert.equal(local, nextLocal, "local entries cover payload area in order");
    assert.ok(local+30 <= directoryStart, "local header bounds");
    assert.equal(bytes.readUInt32LE(local), 0x04034b50, "local signature");
    assert.equal(bytes.readUInt16LE(local+6), flags, "local flags");
    assert.equal(bytes.readUInt16LE(local+8), method, "local compression method");
    assert.equal(bytes.readUInt32LE(local+14), crc, "central CRC matches local CRC");
    assert.equal(bytes.readUInt32LE(local+18), size, "local compressed size");
    assert.equal(bytes.readUInt32LE(local+22), size, "local uncompressed size");
    const localNameLength = bytes.readUInt16LE(local+26), localExtraLength = bytes.readUInt16LE(local+28);
    assert.equal(localNameLength,nameLength,"local name length");
    const start = local+30+localNameLength+localExtraLength;
    assert.ok(start+size <= directoryStart,"file contents bounds");
    assert.deepEqual(bytes.subarray(local+30,local+30+localNameLength),nameBytes,"local UTF-8 name");
    const data = bytes.subarray(start,start+size);
    assert.equal(crc32(data),crc,"central CRC matches actual file contents");
    entries.push({name, bytes:data, data:new Uint8Array(data.buffer,data.byteOffset,data.length)});
    nextLocal = start+size;
    at = next;
  }
  assert.equal(at,end,"central entry count and size");
  assert.equal(nextLocal,directoryStart,"no unlisted local entries");
  return entries;
}

export async function readStoredZip(blob) {
  return readStoredZipBytes(new Uint8Array(await blob.arrayBuffer()));
}

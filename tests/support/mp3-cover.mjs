import assert from 'node:assert/strict';

export function readCover(bytes) {
  assert.equal(bytes.subarray(0, 3).toString(), 'ID3');
  assert.equal(bytes[3], 3);
  assert.equal(bytes[5], 0, 'Musicで確認した形式で画像バイトをそのまま格納する');
  const size = bytes.subarray(6, 10).reduce((value, byte) => value * 128 + byte, 0);
  assert.ok(size + 10 <= bytes.length);
  const titleSize = bytes.readUInt32BE(14);
  assert.equal(bytes.subarray(10, 14).toString(), 'TIT2');
  const titleBytes = bytes.subarray(20, 20 + titleSize);
  const title = titleBytes[0] === 1 ? titleBytes.subarray(3).toString('utf16le') : titleBytes.subarray(1).toString('latin1');
  if (titleBytes[0] === 1) assert.deepEqual(titleBytes.subarray(1, 3), Buffer.from([255, 254]));
  const frame = bytes.subarray(20 + titleSize, 10 + size);
  assert.equal(frame.subarray(0, 4).toString(), 'APIC');
  assert.equal(frame.readUInt32BE(4), frame.length - 10);
  assert.equal(frame[10], 0);
  const mimeEnd = frame.indexOf(0, 11);
  assert.equal(frame[mimeEnd + 1], 3, 'front cover');
  assert.equal(frame[mimeEnd + 2], 0, 'empty description');
  return {title, mime: frame.subarray(11, mimeEnd).toString(), image: frame.subarray(mimeEnd + 3), audioOffset: 10 + size};
}

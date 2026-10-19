import assert from 'node:assert/strict';

export function readCover(bytes) {
  assert.equal(bytes.subarray(0, 3).toString(), 'ID3');
  assert.equal(bytes[3], 3);
  const size = bytes.subarray(6, 10).reduce((value, byte) => value * 128 + byte, 0);
  assert.ok(size + 10 <= bytes.length);
  const stored = bytes.subarray(10, 10 + size), decoded = [];
  for (let i = 0; i < stored.length; i++) {
    decoded.push(stored[i]);
    if ((bytes[5] & 0x80) && stored[i] === 255 && stored[i + 1] === 0) i++;
  }
  const frame = Buffer.from(decoded);
  assert.equal(frame.subarray(0, 4).toString(), 'APIC');
  assert.equal(frame.readUInt32BE(4), frame.length - 10);
  assert.equal(frame[10], 0);
  const mimeEnd = frame.indexOf(0, 11);
  assert.equal(frame[mimeEnd + 1], 3, 'front cover');
  assert.equal(frame[mimeEnd + 2], 0, 'empty description');
  return {mime: frame.subarray(11, mimeEnd).toString(), image: frame.subarray(mimeEnd + 3), audioOffset: 10 + size};
}

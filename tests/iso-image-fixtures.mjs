// Offline 2 × 2 red image and red/blue sequence, generated with Pillow/libavif.
export const staticAvif = Buffer.from('AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAKgAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAAAgAAAAIAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAAMm1kYXQSAAoIGAA2iAhoNCAyHBTHh4ZlAgggnlAAAABIWtlc1jIgMQsbXgqRN4A=', 'base64');
export const animatedAvif = Buffer.from('AAAALGZ0eXBhdmlzAAAAAGF2aWZhdmlzbXNmMWlzbzhtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAPlAAAAJwAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAAAgAAAAIAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAACxm1vb3YAAAB4bXZoZAEAAAAAAAAA5vaLswAAAADm9ouzAAAD6P//////////AAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAJGdHJhawAAAGh0a2hkAQAAAQAAAADm9ouzAAAAAOb2i7MAAAABAAAAAP//////////AAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAACAAAAAgAAAAAALGVkdHMAAAAkZWxzdAEAAAEAAAABAAAAAAAAAMgAAAAAAAAAAAABAAAAAAGqbWRpYQAAACxtZGhkAQAAAAAAAADm9ouzAAAAAOb2i7MAAAPoAAAAAAAAAMhVxAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAABVW1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAARVzdGJsAAAAlXN0c2QAAAAAAAAAAQAAAIVhdjAxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAIAAgBIAAAASAAAAAAAAAABCkFPTSBDb2RpbmcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABBjY3N0AAAAAHwAAAAAAAAYc3R0cwAAAAAAAAABAAAAAgAAAGQAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAIAAAABAAAAHHN0c3oAAAAAAAAAAAAAAAIAAAAnAAAAIAAAABRzdGNvAAAAAAAAAAEAAAPlAAAAFHN0c3MAAAAAAAAAAQAAAAEAAABPbWRhdBIACgwAAAAABm18yAhoNCAyFRAAoAAAAkAAAEZp7e7s1VRRxDbYuBIAMhwwA8CAAABGoAAAAkAAAIAAHuX9dDxrfRBeYbQB', 'base64');


// Split the original AV1 payload into contiguous one-byte extents without
// changing encoded pixels, then insert valid empty free boxes before mdat.
export function extentAvif(freeCount, split = true) {
  const iloc = staticAvif.indexOf('iloc') - 4, mdat = staticAvif.indexOf('mdat') - 4;
  const originalSize = staticAvif.readUInt32BE(iloc), originalStart = staticAvif.readUInt32BE(iloc + 22);
  const length = staticAvif.readUInt32BE(iloc + 26), count = split ? length : 1;
  const locations = Buffer.alloc(22 + count * 8);
  staticAvif.copy(locations, 0, iloc, iloc + 22);
  locations.writeUInt32BE(locations.length); locations.writeUInt16BE(count, 20);
  const shift = locations.length - originalSize, free = Buffer.alloc(freeCount * 8);
  for (let at = 0; at < free.length; at += 8) { free.writeUInt32BE(8, at); free.write('free', at + 4); }
  for (let i = 0; i < count; i++) {
    locations.writeUInt32BE(originalStart + shift + free.length + (split ? i : 0), 22 + i * 8);
    locations.writeUInt32BE(split ? 1 : length, 26 + i * 8);
  }
  const prefix = Buffer.concat([staticAvif.subarray(0, iloc), locations, staticAvif.subarray(iloc + originalSize, mdat)]);
  const meta = prefix.indexOf('meta') - 4;
  prefix.writeUInt32BE(staticAvif.readUInt32BE(meta) + shift, meta);
  return Buffer.concat([prefix, free, staticAvif.subarray(mdat)]);
}

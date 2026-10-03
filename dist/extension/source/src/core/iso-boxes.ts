export interface IsoBox {
  readonly type: string;
  readonly dataStart: number;
  readonly end: number;
  readonly extendsToEnd: boolean;
}

function uint32(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 0x1000000 + (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) + bytes[offset + 3]!;
}

/** Read one ISO BMFF box without allowing its payload or extended header outside its parent. */
export function readIsoBox(bytes: Uint8Array, start: number, end: number): IsoBox | null {
  if (start < 0 || end > bytes.byteLength || end - start < 8) return null;
  const size32 = uint32(bytes, start);
  let size = size32;
  let headerSize = 8;
  if (size32 === 1) {
    if (end - start < 16) return null;
    const high = uint32(bytes, start + 8);
    if (high > 0x1fffff) return null;
    size = high * 0x100000000 + uint32(bytes, start + 12);
    headerSize = 16;
  } else if (size32 === 0) {
    size = end - start;
  }
  if (!Number.isSafeInteger(size) || size < headerSize || size > end - start) return null;
  const type = String.fromCharCode(bytes[start + 4]!, bytes[start + 5]!, bytes[start + 6]!, bytes[start + 7]!);
  return {type, dataStart: start + headerSize, end: start + size, extendsToEnd: size32 === 0};
}

/** Validate as traversal advances, so a caller may intentionally stop at the first matching box. */
export function* isoBoxes(bytes: Uint8Array, start: number, end: number): Generator<IsoBox> {
  for (let offset = start; offset < end;) {
    const box = readIsoBox(bytes, offset, end);
    if (!box) throw new Error("Invalid ISO box bounds");
    yield box;
    offset = box.end;
  }
}

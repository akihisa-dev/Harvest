const GIF_COLOR_TABLE_FLAG = 0x80;
const GIF_TRAILER = 0x3b;
const GIF_EXTENSION = 0x21;
const GIF_IMAGE_DESCRIPTOR = 0x2c;

function readUint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function gifColorTableSize(flags: number): number {
  return flags & GIF_COLOR_TABLE_FLAG ? 3 * (1 << ((flags & 7) + 1)) : 0;
}

/** Return the next position and payload size only when a zero-length terminator exists. */
function readGifSubBlocks(bytes: Uint8Array, offset: number): {end: number; dataSize: number} | null {
  let dataSize = 0;
  while (offset < bytes.length) {
    const size = bytes[offset++]!;
    if (size === 0) return {end: offset, dataSize};
    if (offset + size > bytes.length) return null;
    dataSize += size;
    offset += size;
  }
  return null;
}

/** Validate container boundaries without decoding or changing original media bytes. */
export function hasCompleteGif(bytes: Uint8Array): boolean {
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (!["GIF87a", "GIF89a"].includes(signature) || bytes.length < 13) return false;
  const screenWidth = readUint16LittleEndian(bytes, 6);
  const screenHeight = readUint16LittleEndian(bytes, 8);
  if (!screenWidth || !screenHeight) return false;

  const screenFlags = bytes[10]!;
  let offset = 13 + gifColorTableSize(screenFlags);
  let frameCount = 0;
  while (offset < bytes.length) {
    const marker = bytes[offset++]!;
    if (marker === GIF_TRAILER) return frameCount > 0;
    if (marker === GIF_EXTENSION) {
      if (offset >= bytes.length) return false;
      offset += 1; // Extension label; unknown extensions remain forward compatible.
      const extensionData = readGifSubBlocks(bytes, offset);
      if (!extensionData) return false;
      offset = extensionData.end;
      continue;
    }

    if (marker !== GIF_IMAGE_DESCRIPTOR || offset + 9 > bytes.length) return false;
    const frameWidth = readUint16LittleEndian(bytes, offset + 4);
    const frameHeight = readUint16LittleEndian(bytes, offset + 6);
    if (!frameWidth || !frameHeight) return false;
    const imageFlags = bytes[offset + 8]!;
    if (!(screenFlags & GIF_COLOR_TABLE_FLAG) && !(imageFlags & GIF_COLOR_TABLE_FLAG)) return false;
    offset += 9 + gifColorTableSize(imageFlags);
    if (offset >= bytes.length || bytes[offset]! < 2 || bytes[offset]! > 8) return false;
    offset += 1; // LZW minimum code size.
    const imageData = readGifSubBlocks(bytes, offset);
    if (!imageData || imageData.dataSize === 0) return false;
    offset = imageData.end;
    frameCount += 1;
  }
  return false;
}

/** Opaque boxes/codecs are allowed; known container boxes must fit their parent. */
export function hasCompleteMp4Boxes(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const containerTypes = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "mvex", "moof", "traf"]);
  let hasMovieBox = false;
  let hasMediaData = false;

  const validateBoxRange = (start: number, end: number, depth: number): boolean => {
    if (depth > 16) return false;
    for (let offset = start; offset < end;) {
      if (end - offset < 8) return false;
      let size = view.getUint32(offset);
      let headerSize = 8;
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (size === 1) {
        if (end - offset < 16) return false;
        size = Number(view.getBigUint64(offset + 8));
        headerSize = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (!Number.isSafeInteger(size) || size < headerSize || size > end - offset) return false;
      if (depth === 0 && type === "moov") hasMovieBox = true;
      if (depth === 0 && type === "mdat" && size > headerSize) hasMediaData = true;
      if (containerTypes.has(type) && !validateBoxRange(offset + headerSize, offset + size, depth + 1)) return false;
      offset += size;
    }
    return true;
  };
  return validateBoxRange(0, bytes.length, 0) && hasMovieBox && hasMediaData;
}

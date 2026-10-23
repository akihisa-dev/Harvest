/** Inspect the mandatory VP8/VP8L image header, not the compressed pixel stream. */
function validImageHeader(bytes: Uint8Array, start: number, size: number, lossless: boolean): boolean {
  if (lossless) {
      // Signature, 14-bit dimensions, alpha hint and three zero version bits.
      return size >= 5 && bytes[start] === 0x2f && (bytes[start + 4]! & 0xe0) === 0;
  }
  if (size < 10) return false;
  const tag = bytes[start]!;
  return (tag & 1) === 0 && ((tag >> 1) & 7) <= 3 && (tag & 0x10) !== 0 &&
      bytes[start + 3] === 0x9d && bytes[start + 4] === 0x01 && bytes[start + 5] === 0x2a &&
      (bytes[start + 6]! | ((bytes[start + 7]! & 0x3f) << 8)) > 0 &&
      (bytes[start + 8]! | ((bytes[start + 9]! & 0x3f) << 8)) > 0;
}

/** Inspect WebP container bounds without allocating pixels or decoding frames. */
export function inspectWebpAnimation(bytes: Uint8Array): "static" | "animated" | "invalid" | null {
  const text = (offset: number, value: string): boolean => [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
  if (!text(0, "RIFF") || !text(8, "WEBP"))
      return null;
  if (bytes.length < 20)
      return "invalid";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length)
      return "invalid";
  let animationFlag = false, animationHeader = false, frames = 0, stillImage = false;
  for (let offset = 12; offset < bytes.length;) {
      if (offset + 8 > bytes.length)
          return "invalid";
      const size = view.getUint32(offset + 4, true);
      const start = offset + 8, end = start + size, next = end + (size % 2);
      if (next > bytes.length)
          return "invalid";
      if (text(offset, "VP8X")) {
          if (size !== 10)
              return "invalid";
          animationFlag ||= !!(bytes[start]! & 2);
      }
      else if (text(offset, "ANIM")) {
          if (size !== 6)
              return "invalid";
          animationHeader = true;
      }
      else if (text(offset, "ANMF")) {
          if (size < 16)
              return "invalid";
          let frameImage = false;
          for (let inner = start + 16; inner < end;) {
              if (inner + 8 > end)
                  return "invalid";
              const innerSize = view.getUint32(inner + 4, true);
              const innerEnd = inner + 8 + innerSize + (innerSize % 2);
              if (innerEnd > end)
                  return "invalid";
              if (text(inner, "VP8 ") || text(inner, "VP8L")) {
                  if (!validImageHeader(bytes, inner + 8, innerSize, text(inner, "VP8L"))) return "invalid";
                  frameImage = true;
              }
              inner = innerEnd;
          }
          if (!frameImage)
              return "invalid";
          frames++;
      }
      else if (text(offset, "VP8 ") || text(offset, "VP8L")) {
          if (!validImageHeader(bytes, start, size, text(offset, "VP8L"))) return "invalid";
          stillImage = true;
      }
      offset = next;
  }
  if (animationFlag || animationHeader || frames) {
      return animationFlag && animationHeader && frames > 0 && !stillImage ? "animated" : "invalid";
  }
  return stillImage ? "static" : "invalid";
}

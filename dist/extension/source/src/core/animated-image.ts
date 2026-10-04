import { inspectWebpAnimation } from "./webp-animation.js";
import { readIsoBox } from "./iso-boxes.js";
/** A bounded container hint gates animation decoding, including unavailable codecs. */
export function animatedImageType(bytes: Uint8Array): string | null {
  const text = (at: number, value: string): boolean => [...value].every((c, i) => bytes[at + i] === c.charCodeAt(0));
  const webp = inspectWebpAnimation(bytes);
  if (webp === "invalid")
      throw new Error("アニメーション画像のデータが不完全または破損しています。");
  if (webp === "animated")
      return "image/webp";
  if (webp === "static")
      return null;
  if (text(0, "\x89PNG\r\n\x1a\n")) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let offset = 8; offset < bytes.length;) {
          if (offset + 12 > bytes.length)
              throw new Error("アニメーション画像のデータが不完全または破損しています。");
          const size = view.getUint32(offset), end = offset + 12 + size;
          if (end > bytes.length)
              throw new Error("アニメーション画像のデータが不完全または破損しています。");
          if (text(offset + 4, "acTL")) {
              if (size !== 8 || view.getUint32(offset + 8) < 1)
                  throw new Error("アニメーション画像のデータが不完全または破損しています。");
              return "image/png";
          }
          offset = end;
      }
  }
  const box = readIsoBox(bytes, 0, bytes.length);
  if (box?.type === "ftyp") {
      if (box.end - box.dataStart > 4096)
          throw new Error("アニメーション画像のデータが不完全または破損しています。");
      for (let offset = box.dataStart; offset + 4 <= box.end; offset += 4) {
          if (offset === box.dataStart + 4)
              continue;
          if (text(offset, "avis"))
              return "image/avif";
      }
  }
  return null;
}
/** Cross-check declared WebP/APNG frames against the decoder's completed track. */
export function declaredAnimationFrames(bytes: Uint8Array, type: string): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === "image/webp") {
      let frames = 0;
      for (let offset = 12; offset + 8 <= bytes.length;) {
          const size = view.getUint32(offset + 4, true);
          if (String.fromCharCode(...bytes.subarray(offset, offset + 4)) === "ANMF")
              frames++;
          offset += 8 + size + size % 2;
      }
      return frames;
  }
  if (type === "image/png") {
      for (let offset = 8; offset + 12 <= bytes.length;) {
          const size = view.getUint32(offset);
          if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === "acTL")
              return view.getUint32(offset + 8);
          offset += 12 + size;
      }
  }
  return null;
}

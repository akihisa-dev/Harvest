import {gifColorTableSize, readGifSubBlocks} from "./gif-blocks.js";
import {isoBoxes, type IsoBox} from "./iso-boxes.js";

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function hasAscii(bytes: Uint8Array, offset: number, value: string): boolean {
  if (offset < 0 || offset + value.length > bytes.byteLength) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

function readUint16BigEndian(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 2 > bytes.byteLength) return null;
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > bytes.byteLength) return null;
  return (((bytes[offset] ?? 0) * 0x1000000) +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0));
}

function readUint16LittleEndian(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 2 > bytes.byteLength) return null;
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 3 > bytes.byteLength) return null;
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > bytes.byteLength) return null;
  return ((bytes[offset] ?? 0) +
    ((bytes[offset + 1] ?? 0) * 0x100) +
    ((bytes[offset + 2] ?? 0) * 0x10000) +
    ((bytes[offset + 3] ?? 0) * 0x1000000));
}

function pngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.byteLength < 24 || !pngSignature.every((value, index) => bytes[index] === value) ||
      readUint32BigEndian(bytes, 8) !== 13 || !hasAscii(bytes, 12, "IHDR")) return null;
  const width = readUint32BigEndian(bytes, 16);
  const height = readUint32BigEndian(bytes, 20);
  return width === null || height === null ? null : {width, height};
}

function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset < bytes.byteLength) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) return null;
    const marker = bytes[offset++] ?? 0;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = readUint16BigEndian(bytes, offset);
    if (length === null || length < 2 || offset + length > bytes.byteLength) return null;
    if (startOfFrameMarkers.has(marker)) {
      if (length < 8) return null;
      const height = readUint16BigEndian(bytes, offset + 3);
      const width = readUint16BigEndian(bytes, offset + 5);
      return width === null || height === null ? null : {width, height};
    }
    offset += length;
  }
  return null;
}

function gifDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.byteLength < 10 || (!hasAscii(bytes, 0, "GIF87a") && !hasAscii(bytes, 0, "GIF89a"))) return null;
  const width = readUint16LittleEndian(bytes, 6);
  const height = readUint16LittleEndian(bytes, 8);
  if (width === null || height === null) return null;
  let maximumWidth = width;
  let maximumHeight = height;
  if (bytes.byteLength < 13) return {width: maximumWidth, height: maximumHeight};
  const logicalScreenFlags = bytes[10] ?? 0;
  let offset = 13 + gifColorTableSize(logicalScreenFlags);
  while (offset < bytes.byteLength) {
    const marker = bytes[offset++] ?? 0;
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      if (offset >= bytes.byteLength) break;
      offset += 1;
      offset = readGifSubBlocks(bytes, offset)?.end ?? bytes.byteLength;
      continue;
    }
    if (marker !== 0x2c || offset + 9 > bytes.byteLength) break;
    const left = readUint16LittleEndian(bytes, offset) ?? 0;
    const top = readUint16LittleEndian(bytes, offset + 2) ?? 0;
    const frameWidth = readUint16LittleEndian(bytes, offset + 4) ?? 0;
    const frameHeight = readUint16LittleEndian(bytes, offset + 6) ?? 0;
    maximumWidth = Math.max(maximumWidth, left + frameWidth);
    maximumHeight = Math.max(maximumHeight, top + frameHeight);
    const imageFlags = bytes[offset + 8] ?? 0;
    offset += 9 + gifColorTableSize(imageFlags);
    if (offset >= bytes.byteLength) break;
    offset = readGifSubBlocks(bytes, offset + 1)?.end ?? bytes.byteLength;
  }
  return {width: maximumWidth, height: maximumHeight};
}

function webpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.byteLength < 20 || !hasAscii(bytes, 0, "RIFF") || !hasAscii(bytes, 8, "WEBP")) return null;
  const riffSize = readUint32LittleEndian(bytes, 4);
  if (riffSize === null || riffSize < 12 || riffSize + 8 > bytes.byteLength) return null;
  const end = riffSize + 8;
  let offset = 12;
  let extendedDimensions: ImageDimensions | null = null;
  let imageDimensions: ImageDimensions | null = null;
  while (offset + 8 <= end) {
    const size = readUint32LittleEndian(bytes, offset + 4);
    if (size === null || size > end - offset - 8) return null;
    const chunkDataOffset = offset + 8;
    if (hasAscii(bytes, offset, "VP8X") && size >= 10) {
      const width = readUint24LittleEndian(bytes, chunkDataOffset + 4);
      const height = readUint24LittleEndian(bytes, chunkDataOffset + 7);
      if (width !== null && height !== null) extendedDimensions = {width: width + 1, height: height + 1};
    } else if (hasAscii(bytes, offset, "VP8 ") && size >= 10 &&
        bytes[chunkDataOffset + 3] === 0x9d && bytes[chunkDataOffset + 4] === 0x01 && bytes[chunkDataOffset + 5] === 0x2a) {
      const rawWidth = readUint16LittleEndian(bytes, chunkDataOffset + 6);
      const rawHeight = readUint16LittleEndian(bytes, chunkDataOffset + 8);
      if (rawWidth !== null && rawHeight !== null) imageDimensions = {width: rawWidth & 0x3fff, height: rawHeight & 0x3fff};
    } else if (hasAscii(bytes, offset, "VP8L") && size >= 5 && bytes[chunkDataOffset] === 0x2f) {
      const b1 = bytes[chunkDataOffset + 1] ?? 0;
      const b2 = bytes[chunkDataOffset + 2] ?? 0;
      const b3 = bytes[chunkDataOffset + 3] ?? 0;
      const b4 = bytes[chunkDataOffset + 4] ?? 0;
      imageDimensions = {
        width: 1 + b1 + ((b2 & 0x3f) << 8),
        height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)),
      };
    }
    offset += 8 + size + (size & 1);
  }
  return extendedDimensions ?? imageDimensions;
}

function bmpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.byteLength < 26 || !hasAscii(bytes, 0, "BM")) return null;
  const headerSize = readUint32LittleEndian(bytes, 14);
  if (headerSize === null) return null;
  if (headerSize === 12) {
    const width = readUint16LittleEndian(bytes, 18);
    const height = readUint16LittleEndian(bytes, 20);
    return width === null || height === null ? null : {width, height};
  }
  if (headerSize < 40 || bytes.byteLength < 26) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getInt32(18, true);
  const signedHeight = view.getInt32(22, true);
  return {width, height: Math.abs(signedHeight)};
}

function avifDimensions(bytes: Uint8Array): ImageDimensions | null {
  try { return inspectAvifDimensions(bytes); } catch { return null; }
}

/** Traverse all bounds, retaining only the first requested boxes. */
function selectedIsoBoxes(bytes: Uint8Array, start: number, end: number, types: readonly string[]): Map<string, IsoBox> {
  const selected = new Map<string, IsoBox>();
  for (const box of isoBoxes(bytes, start, end)) {
    if (types.includes(box.type) && !selected.has(box.type)) selected.set(box.type, box);
  }
  return selected;
}

function inspectAvifDimensions(bytes: Uint8Array): ImageDimensions | null {
  let fileType: IsoBox | undefined;
  for (const box of isoBoxes(bytes, 0, bytes.byteLength)) {
    if (box.type === "ftyp") { fileType = box; break; }
  }
  if (!fileType || fileType.end - fileType.dataStart < 8) return null;
  let avif = false;
  for (let offset = fileType.dataStart; offset + 4 <= fileType.end; offset += 4) {
    if (offset === fileType.dataStart + 4) continue; // minor version is not a brand
    if (hasAscii(bytes, offset, "avif") || hasAscii(bytes, offset, "avis")) { avif = true; break; }
  }
  if (!avif) return null;
  const meta = selectedIsoBoxes(bytes, 0, bytes.byteLength, ["meta"]).get("meta");
  if (!meta || meta.dataStart + 4 > meta.end) return null;
  const metaChildren = selectedIsoBoxes(bytes, meta.dataStart + 4, meta.end, ["pitm", "iprp"]);
  const primaryBox = metaChildren.get("pitm");
  if (!primaryBox || primaryBox.dataStart + 4 > primaryBox.end) return null;
  const primaryVersion = bytes[primaryBox.dataStart] ?? 0;
  const primaryIdWidth = primaryVersion === 0 ? 2 : 4;
  if (primaryBox.dataStart + 4 + primaryIdWidth > primaryBox.end) return null;
  const primaryId = primaryVersion === 0
    ? readUint16BigEndian(bytes, primaryBox.dataStart + 4)
    : readUint32BigEndian(bytes, primaryBox.dataStart + 4);
  if (primaryId === null) return null;
  const itemProperties = metaChildren.get("iprp");
  if (!itemProperties) return null;
  const propertyContainer = selectedIsoBoxes(bytes, itemProperties.dataStart, itemProperties.end, ["ipco"]).get("ipco");
  if (!propertyContainer) return null;
  const spatialExtents = avifSpatialExtents(bytes, isoBoxes(bytes, propertyContainer.dataStart, propertyContainer.end));
  return avifPrimaryDimensions(bytes, isoBoxes(bytes, itemProperties.dataStart, itemProperties.end), primaryId, spatialExtents);
}

/** Property indexes are one-based; non-dimension properties keep their slot. */
function avifSpatialExtents(bytes: Uint8Array, properties: Iterable<IsoBox>): ReadonlyMap<number, ImageDimensions> {
  const spatialExtents = new Map<number, ImageDimensions>();
  let index = 0;
  for (const property of properties) {
    index += 1;
    if (property.type !== "ispe" || property.dataStart + 12 > property.end) {
      continue;
    }
    const width = readUint32BigEndian(bytes, property.dataStart + 4);
    const height = readUint32BigEndian(bytes, property.dataStart + 8);
    if (width !== null && height !== null) spatialExtents.set(index, {width, height});
  }

  return spatialExtents;
}

/** Follow item/property associations in file order and retain the first matching dimensions. */
function avifPrimaryDimensions(
  bytes: Uint8Array,
  propertyChildren: Iterable<IsoBox>,
  primaryId: number,
  spatialExtents: ReadonlyMap<number, ImageDimensions>,
): ImageDimensions | null {
  for (const associationBox of propertyChildren) {
    if (associationBox.type !== "ipma") continue;
    if (associationBox.dataStart + 8 > associationBox.end) return null;
    const version = bytes[associationBox.dataStart] ?? 0;
    const flags = ((bytes[associationBox.dataStart + 1] ?? 0) << 16) |
      ((bytes[associationBox.dataStart + 2] ?? 0) << 8) | (bytes[associationBox.dataStart + 3] ?? 0);
    const entryCount = readUint32BigEndian(bytes, associationBox.dataStart + 4);
    if (entryCount === null) return null;
    let offset = associationBox.dataStart + 8;
    for (let entry = 0; entry < entryCount; entry += 1) {
      const idWidth = version === 0 ? 2 : 4;
      if (offset + idWidth + 1 > associationBox.end) return null;
      const itemId = version === 0 ? readUint16BigEndian(bytes, offset) : readUint32BigEndian(bytes, offset);
      if (itemId === null) return null;
      offset += idWidth;
      const associationCount = bytes[offset++] ?? 0;
      let primaryDimensions: ImageDimensions | null = null;
      for (let index = 0; index < associationCount; index += 1) {
        const hasWidePropertyIndex = (flags & 1) !== 0;
        if (offset + (hasWidePropertyIndex ? 2 : 1) > associationBox.end) return null;
        const association = hasWidePropertyIndex ? readUint16BigEndian(bytes, offset) : bytes[offset] ?? null;
        if (association === null) return null;
        offset += hasWidePropertyIndex ? 2 : 1;
        const propertyIndex = hasWidePropertyIndex ? association & 0x7fff : association & 0x7f;
        if (itemId === primaryId) primaryDimensions ??= spatialExtents.get(propertyIndex) ?? null;
      }
      if (itemId === primaryId && primaryDimensions) return primaryDimensions;
    }
    if (offset !== associationBox.end) return null;
  }
  return null;
}

/** Inspect only a bounded XML prefix; never resolve entities or external resources. */
function svgDimensions(bytes: Uint8Array): ImageDimensions | null {
  const text = new TextDecoder().decode(bytes.subarray(0, 65_536)).replace(/^\uFEFF/, "");
  let remaining = text.trimStart();
  while (remaining.startsWith("<?") || remaining.startsWith("<!--")) {
    const ending = remaining.startsWith("<?") ? "?>" : "-->";
    const end = remaining.indexOf(ending);
    if (end < 0) return null;
    remaining = remaining.slice(end + ending.length).trimStart();
  }
  const root = /^<svg(?=\s|\/?>)((?:[^"'<>]|"[^"]*"|'[^']*')*)\/?>/.exec(remaining);
  if (!root) return null;
  const attributes = new Map<string, string>();
  let rest = root[1]!.replace(/\/\s*$/, "");
  while (rest.trim()) {
    const attribute = /^\s+([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(rest);
    if (!attribute || attributes.has(attribute[1]!)) return null;
    attributes.set(attribute[1]!, attribute[2] ?? attribute[3] ?? "");
    rest = rest.slice(attribute[0].length);
  }
  const dimension = (name: string): number | null => {
    const value = attributes.get(name)?.trim();
    if (!value || !/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:px)?$/.test(value)) return null;
    return Math.ceil(Number(value.replace(/px$/, "")));
  };
  const width = dimension("width"), height = dimension("height");
  return width === null || height === null ? null : {width, height};
}

/** Read dimensions from image headers without asking a browser decoder to expand pixels. */
export function getImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (!(bytes instanceof Uint8Array)) return null;
  return pngDimensions(bytes) ?? jpegDimensions(bytes) ?? gifDimensions(bytes) ??
    webpDimensions(bytes) ?? bmpDimensions(bytes) ?? avifDimensions(bytes) ?? svgDimensions(bytes);
}

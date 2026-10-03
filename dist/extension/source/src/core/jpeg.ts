import type { PdfJpegImagePage } from "./pdf-types.js";

export interface JpegStructure {
  readonly width: number;
  readonly height: number;
  readonly canEmbed: boolean;
}

/** Checks complete JPEG segments and scans; pixel validity still requires a decoder. */
export function inspectJpegStructure(bytes: Uint8Array): JpegStructure | null {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const byte = (index: number): number => bytes[index] ?? -1;
  const startOfFrameMarkers = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf];
  const quantizationTables = new Set<number>();
  const huffmanTables = new Set<number>();
  const componentQuantizationTables = new Map<number, number>();
  let frame: {width: number; height: number; marker: number; precision: number} | undefined;
  let hasJfif = false;
  let hasMetadata = false;
  let scanCount = 0;
  let offset = 2;
  while (offset < bytes.length) {
    if (byte(offset++) !== 0xff) return null;
    while (byte(offset) === 0xff) offset += 1;
    const marker = byte(offset++);
    if (marker === 0xd9) {
      return frame && scanCount > 0 ? {
        width: frame.width,
        height: frame.height,
        canEmbed: hasJfif && !hasMetadata && (frame.marker === 0xc0 || frame.marker === 0xc2) &&
          frame.precision === 8 && componentQuantizationTables.size === 3,
      } : null;
    }
    if (marker === 0x01) continue;
    if (marker < 0 || marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) return null;
    const length = (byte(offset) << 8) | byte(offset + 1);
    if (length < 2 || offset + length > bytes.length) return null;
    const start = offset + 2;
    const end = offset + length;
    if (marker === 0xe0 && length >= 7 && [0x4a, 0x46, 0x49, 0x46, 0].every((value, index) => byte(start + index) === value)) {
      if (length < 16 || length !== 16 + 3 * byte(start + 12) * byte(start + 13)) return null;
      hasJfif = true;
    }
    if (marker === 0xe1 || marker === 0xe2 || marker === 0xee) hasMetadata = true;
    // Frame dimensions and the quantization table assigned to each component.
    if (startOfFrameMarkers.includes(marker)) {
      const count = byte(start + 5);
      if (frame || count < 1 || length !== 8 + 3 * count) return null;
      const height = (byte(start + 1) << 8) | byte(start + 2);
      const width = (byte(start + 3) << 8) | byte(start + 4);
      if (width < 1 || height < 1) return null;
      for (let index = 0; index < count; index += 1) {
        const component = start + 6 + 3 * index;
        const id = byte(component);
        const sampling = byte(component + 1);
        const table = byte(component + 2);
        if (componentQuantizationTables.has(id) || (sampling >> 4) < 1 || (sampling & 15) < 1 || table > 3) return null;
        componentQuantizationTables.set(id, table);
      }
      frame = {width, height, marker, precision: byte(start)};
    }
    // Quantization tables (DQT).
    if (marker === 0xdb) {
      let cursor = start;
      if (cursor === end) return null;
      while (cursor < end) {
        const table = byte(cursor++);
        if ((table >> 4) > 1 || (table & 15) > 3) return null;
        cursor += (table >> 4) === 0 ? 64 : 128;
        if (cursor > end) return null;
        quantizationTables.add(table & 15);
      }
    }
    // Huffman tables (DHT).
    if (marker === 0xc4) {
      let cursor = start;
      if (cursor === end) return null;
      while (cursor < end) {
        const table = byte(cursor++);
        if ((table >> 4) > 1 || (table & 15) > 3 || cursor + 16 > end) return null;
        let symbols = 0;
        for (let index = 0; index < 16; index += 1) symbols += byte(cursor++);
        if (symbols < 1 || symbols > 256 || cursor + symbols > end) return null;
        cursor += symbols;
        huffmanTables.add(table);
      }
    }
    offset = end;
    if (marker !== 0xda) continue;

    // Scan header (SOS): every referenced component and required table must exist.
    const count = byte(start);
    if (!frame || count < 1 || count > componentQuantizationTables.size || length !== 6 + 2 * count) return null;
    const scanComponents = new Set<number>();
    const spectralStart = byte(start + 1 + count * 2);
    const approximation = byte(end - 1);
    for (let index = 0; index < count; index += 1) {
      const id = byte(start + 1 + index * 2);
      const table = byte(start + 2 + index * 2);
      if (!componentQuantizationTables.has(id) || scanComponents.has(id)) return null;
      scanComponents.add(id);
      if (frame.marker === 0xc0 || frame.marker === 0xc2) {
        if (!quantizationTables.has(componentQuantizationTables.get(id)!)) return null;
        if (spectralStart === 0 && (approximation >> 4) === 0 && !huffmanTables.has(table >> 4)) return null;
        if ((frame.marker === 0xc0 || spectralStart > 0) && !huffmanTables.has(0x10 | (table & 15))) return null;
      }
    }

    // Scan data ends at the next marker, except escaped bytes and restart markers.
    let scanDataBytes = 0;
    while (offset < bytes.length) {
      if (byte(offset) !== 0xff) {
        scanDataBytes += 1;
        offset += 1;
        continue;
      }
      const markerStart = offset++;
      while (byte(offset) === 0xff) offset += 1;
      const next = byte(offset);
      if (next === 0) {
        scanDataBytes += 1;
        offset += 1;
        continue;
      }
      if (next >= 0xd0 && next <= 0xd7) {
        offset += 1;
        continue;
      }
      offset = markerStart;
      break;
    }
    if (scanDataBytes === 0) return null;
    scanCount += 1;
  }
  return null;
}

/** Returns a structurally complete direct-embedding candidate without changing its bytes. */
export function getOriginalJpegPage(bytes: Uint8Array): PdfJpegImagePage | null {
  const structure = inspectJpegStructure(bytes);
  return structure?.canEmbed ? {jpeg: bytes, width: structure.width, height: structure.height} : null;
}

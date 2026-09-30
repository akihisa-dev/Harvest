export interface StoredZipEntry {
  readonly filename: string;
  readonly blob: Blob;
}

const ZIP32_MAX = 0xffff_ffff;
const ZIP_ENTRY_MAX = 0xffff;
const utf8 = new TextEncoder();

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (value >>> 1) ^ 0xedb8_8320 : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function abortError(): DOMException {
  return new DOMException("ZIP作成を中止しました。", "AbortError");
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

async function checksum(blob: Blob, signal?: AbortSignal): Promise<number> {
  checkCancelled(signal);
  const reader = blob.stream().getReader();
  const cancel = (): void => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", cancel, {once: true});
  let crc = 0xffff_ffff;
  try {
    while (true) {
      checkCancelled(signal);
      const {done, value} = await reader.read();
      checkCancelled(signal);
      if (done) break;
      for (const byte of value) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]!;
    }
    return (crc ^ 0xffff_ffff) >>> 0;
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

function header(length: number): {bytes: Uint8Array; view: DataView} {
  const bytes = new Uint8Array(length);
  return {bytes, view: new DataView(bytes.buffer)};
}

function validateFilename(filename: string, names: Set<string>): Uint8Array {
  if (!filename || filename === "." || filename === ".." || /[\\/]/.test(filename)) {
    throw new RangeError("ZIP内のファイル名は単一の安全な名前にしてください。");
  }
  if (names.has(filename)) throw new RangeError("ZIP内のファイル名が重複しています。");
  names.add(filename);
  const name = utf8.encode(filename);
  if (name.byteLength > 0xffff) throw new RangeError("ZIP内のファイル名が長すぎます。");
  return name;
}

function validateEntry(entry: StoredZipEntry, names: Set<string>): Uint8Array {
  const name = validateFilename(entry.filename, names);
  if (!Number.isSafeInteger(entry.blob.size) || entry.blob.size > ZIP32_MAX) {
    throw new RangeError("画像がZIP形式の上限を超えています。");
  }
  return name;
}

/** Maximum payload bytes after reserving all ZIP headers, names, and the directory. */
export function storedZipDataLimit(filenames: readonly string[]): number {
  if (filenames.length > ZIP_ENTRY_MAX) throw new RangeError("ZIPに含められる画像数の上限を超えています。");
  const names = new Set<string>();
  let overhead = 22;
  for (const filename of filenames) overhead += 76 + 2 * validateFilename(filename, names).byteLength;
  if (overhead > ZIP32_MAX) throw new RangeError("ZIP全体がZIP形式の上限を超えています。");
  return ZIP32_MAX - overhead;
}

/** Create an uncompressed ZIP while retaining image Blobs as Blob parts. */
export async function createStoredZip(
  entries: readonly StoredZipEntry[],
  options: {readonly signal?: AbortSignal; readonly onProgress?: (completed: number, total: number) => void} = {},
): Promise<Blob> {
  const dataLimit = storedZipDataLimit(entries.map(entry => entry.filename));
  let dataSize = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.blob.size) || entry.blob.size < 0 || entry.blob.size > ZIP32_MAX) {
      throw new RangeError("画像がZIP形式の上限を超えています。");
    }
    dataSize += entry.blob.size;
    if (dataSize > dataLimit) throw new RangeError("ZIP全体がZIP形式の上限を超えています。");
  }
  const names = new Set<string>();
  const parts: BlobPart[] = [];
  const directory: Uint8Array[] = [];
  let localOffset = 0;
  let directorySize = 0;

  for (let index = 0; index < entries.length; index += 1) {
    checkCancelled(options.signal);
    const entry = entries[index]!;
    const name = validateEntry(entry, names);
    const crc = await checksum(entry.blob, options.signal);
    const local = header(30 + name.byteLength);
    local.view.setUint32(0, 0x0403_4b50, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, 0x0800, true);
    local.view.setUint16(8, 0, true);
    local.view.setUint16(10, 0, true);
    local.view.setUint16(12, 0x0021, true);
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, entry.blob.size, true);
    local.view.setUint32(22, entry.blob.size, true);
    local.view.setUint16(26, name.byteLength, true);
    local.view.setUint16(28, 0, true);
    local.bytes.set(name, 30);
    parts.push(local.bytes.buffer as ArrayBuffer, entry.blob);
    localOffset += local.bytes.byteLength + entry.blob.size;
    if (localOffset > ZIP32_MAX) throw new RangeError("ZIP全体がZIP形式の上限を超えています。");

    const central = header(46 + name.byteLength);
    central.view.setUint32(0, 0x0201_4b50, true);
    central.view.setUint16(4, 20, true);
    central.view.setUint16(6, 20, true);
    central.view.setUint16(8, 0x0800, true);
    central.view.setUint16(10, 0, true);
    central.view.setUint16(12, 0, true);
    central.view.setUint16(14, 0x0021, true);
    central.view.setUint32(16, crc, true);
    central.view.setUint32(20, entry.blob.size, true);
    central.view.setUint32(24, entry.blob.size, true);
    central.view.setUint16(28, name.byteLength, true);
    central.view.setUint16(30, 0, true);
    central.view.setUint16(32, 0, true);
    central.view.setUint16(34, 0, true);
    central.view.setUint16(36, 0, true);
    central.view.setUint32(38, 0, true);
    central.view.setUint32(42, localOffset - local.bytes.byteLength - entry.blob.size, true);
    central.bytes.set(name, 46);
    directory.push(central.bytes);
    directorySize += central.bytes.byteLength;
    if (directorySize > ZIP32_MAX) throw new RangeError("ZIP全体がZIP形式の上限を超えています。");
    options.onProgress?.(index + 1, entries.length);
    if ((index + 1) % 16 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  checkCancelled(options.signal);
  const end = header(22);
  end.view.setUint32(0, 0x0605_4b50, true);
  end.view.setUint16(4, 0, true);
  end.view.setUint16(6, 0, true);
  end.view.setUint16(8, entries.length, true);
  end.view.setUint16(10, entries.length, true);
  end.view.setUint32(12, directorySize, true);
  end.view.setUint32(16, localOffset, true);
  end.view.setUint16(20, 0, true);
  for (const central of directory) parts.push(central.buffer as ArrayBuffer);
  parts.push(end.bytes.buffer as ArrayBuffer);
  return new Blob(parts, {type: "application/zip"});
}

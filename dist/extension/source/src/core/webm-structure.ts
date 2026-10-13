/** Check EBML boundaries, including live WebM's unknown Segment/Cluster sizes. */
export function hasCompleteWebm(bytes: Uint8Array): boolean {
  const vint = (offset: number, end: number, id = false): {value: number; size: number; unknown: boolean} | null => {
    const first = bytes[offset];
    if (!first || offset >= end) return null;
    let size = 1, mask = 128;
    while (!(first & mask)) { size++; mask >>= 1; }
    if (size > (id ? 4 : 8) || offset + size > end) return null;
    let value = BigInt(id ? first : first & (mask - 1));
    for (let i = 1; i < size; i++) value = value * 256n + BigInt(bytes[offset + i]!);
    const unknown = !id && value === (1n << BigInt(7 * size)) - 1n;
    if (!unknown && value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return {value: Number(value), size, unknown};
  };
  const masters = new Set([0x1a45dfa3, 0x18538067, 0x114d9b74, 0x4dbb, 0x1549a966,
    0x1654ae6b, 0xae, 0xe0, 0xe1, 0x1f43b675, 0xa0, 0x75a1, 0xa6,
    0x1c53bb6b, 0xbb, 0xb7, 0x55b0, 0x7670, 0x6d80, 0x6240, 0x5034, 0x5035]);
  const levelOne = new Set([0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1f43b675,
    0x1c53bb6b, 0x1941a469, 0x1043a770, 0x1254c367]);
  let header = false, docType = false, segment = false, tracks = false, info = false;
  const videoTracks = new Set<number>(), blockTracks = new Set<number>();
  type Track = {number?: number; type?: number; codec?: boolean; width?: number; height?: number};
  const validBlock = (start: number, end: number): boolean => {
    const track = vint(start, end);
    if (!track || !Number.isSafeInteger(track.value) || !track.value || start + track.size + 3 >= end) return false;
    let offset = start + track.size + 3;
    const lacing = (bytes[offset - 1]! >> 1) & 3;
    if (lacing) {
      const count = bytes[offset++]! + 1;
      if (count < 2 || offset >= end) return false;
      if (lacing === 2) {
        if ((end - offset) % count) return false;
      } else {
        let total = 0, previous = 0;
        for (let frame = 0; frame < count - 1; frame++) {
          let size = 0;
          if (lacing === 1) {
            let part: number;
            do { if (offset >= end) return false; part = bytes[offset++]!; size += part; } while (part === 255);
          } else {
            const encoded = vint(offset, end);
            if (!encoded || !Number.isSafeInteger(encoded.value)) return false;
            offset += encoded.size;
            size = frame === 0 ? encoded.value : previous + encoded.value - (2 ** (7 * encoded.size - 1) - 1);
          }
          if (size <= 0) return false;
          total += size; previous = size;
        }
        if (offset + total >= end) return false;
      }
    }
    blockTracks.add(track.value);
    return true;
  };
  const walk = (start: number, end: number, parent: number, depth: number, unknownParent = false,
    track?: Track): number => {
    if (depth > 16) return -1;
    let offset = start;
    while (offset < end) {
      const id = vint(offset, end, true);
      if (!id) return -1;
      if (unknownParent && parent === 0x1f43b675 && (levelOne.has(id.value) || id.value === 0x18538067 || id.value === 0x1a45dfa3)) return offset;
      if (unknownParent && parent === 0x18538067 && (id.value === 0x18538067 || id.value === 0x1a45dfa3)) return offset;
      const size = vint(offset + id.size, end);
      if (!size) return -1;
      const data = offset + id.size + size.size, limit = size.unknown ? end : data + size.value;
      if (limit > end || (size.unknown && id.value !== 0x18538067 && id.value !== 0x1f43b675)) return -1;
      if (parent === 0 && offset === 0 && id.value !== 0x1a45dfa3) return -1;
      if (parent === 0 && id.value === 0x1a45dfa3) header = true;
      if (parent === 0x1a45dfa3 && id.value === 0x4282) docType = limit - data === 4 && String.fromCharCode(...bytes.subarray(data, limit)) === "webm";
      if (parent === 0 && id.value === 0x18538067) segment = true;
      if (parent === 0x18538067 && id.value === 0x1654ae6b) tracks = true;
      if (parent === 0x18538067 && id.value === 0x1549a966) info = true;
      if (parent === 0xae && track && id.value === 0x86) track.codec = limit > data;
      if (track && ((parent === 0xae && (id.value === 0xd7 || id.value === 0x83))
        || (parent === 0xe0 && (id.value === 0xb0 || id.value === 0xba)))) {
        if (limit - data < 1 || limit - data > 8) return -1;
        let value = 0;
        for (let i = data; i < limit; i++) value = value * 256 + bytes[i]!;
        if (!Number.isSafeInteger(value) || !value) return -1;
        if (id.value === 0xd7) track.number = value;
        else if (id.value === 0x83) track.type = value;
        else if (id.value === 0xb0) track.width = value;
        else track.height = value;
      }
      if ((parent === 0x1f43b675 && id.value === 0xa3) || (parent === 0xa0 && id.value === 0xa1)) {
        if (!validBlock(data, limit)) return -1;
      }
      if (masters.has(id.value)) {
        const entry: Track | undefined = id.value === 0xae ? {} : id.value === 0xe0 ? track : undefined;
        const next = walk(data, limit, id.value, depth + 1, size.unknown, entry);
        if (next < 0) return -1;
        if (id.value === 0xae && entry?.type === 1 && entry.number && entry.codec && entry.width && entry.height) videoTracks.add(entry.number);
        offset = next;
      } else offset = limit;
    }
    return offset;
  };
  return walk(0, bytes.length, 0, 0) === bytes.length && header && docType && segment && tracks && info
    && [...videoTracks].some(track => blockTracks.has(track));
}

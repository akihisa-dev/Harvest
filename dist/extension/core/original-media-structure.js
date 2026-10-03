/** Validate container boundaries without decoding or changing original media bytes. */
export function hasCompleteGif(bytes) {
    const signature = String.fromCharCode(...bytes.subarray(0, 6));
    if (!['GIF87a', 'GIF89a'].includes(signature) || bytes.length < 13)
        return false;
    const word = (offset) => bytes[offset] | bytes[offset + 1] << 8;
    if (!word(6) || !word(8))
        return false;
    let offset = 13;
    const tableSize = (packed) => packed & 128 ? 3 * (1 << ((packed & 7) + 1)) : 0;
    offset += tableSize(bytes[10]);
    let frames = 0;
    const blocks = () => {
        let dataSize = 0;
        while (offset < bytes.length) {
            const size = bytes[offset++];
            if (!size)
                return dataSize;
            if (offset + size > bytes.length)
                return -1;
            dataSize += size;
            offset += size;
        }
        return -1;
    };
    while (offset < bytes.length) {
        const marker = bytes[offset++];
        if (marker === 0x3b)
            return frames > 0;
        if (marker === 0x21) {
            if (offset >= bytes.length)
                return false;
            offset++; // Extension label; unknown extensions remain forward compatible.
            if (blocks() < 0)
                return false;
        }
        else if (marker === 0x2c) {
            if (offset + 9 > bytes.length || !word(offset + 4) || !word(offset + 6))
                return false;
            const packed = bytes[offset + 8];
            if (!(bytes[10] & 128) && !(packed & 128))
                return false;
            offset += 9 + tableSize(packed);
            if (offset >= bytes.length || bytes[offset] < 2 || bytes[offset] > 8)
                return false;
            offset++; // LZW minimum code size.
            if (blocks() <= 0)
                return false;
            frames++;
        }
        else
            return false;
    }
    return false;
}
/** Opaque boxes/codecs are allowed; known container boxes must fit their parent. */
export function hasCompleteMp4Boxes(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'mvex', 'moof', 'traf']);
    let movie = false, media = false;
    const visit = (start, end, depth) => {
        if (depth > 16)
            return false;
        for (let offset = start; offset < end;) {
            if (end - offset < 8)
                return false;
            let size = view.getUint32(offset);
            let header = 8;
            const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
            if (size === 1) {
                if (end - offset < 16)
                    return false;
                size = Number(view.getBigUint64(offset + 8));
                header = 16;
            }
            else if (size === 0)
                size = end - offset;
            if (!Number.isSafeInteger(size) || size < header || size > end - offset)
                return false;
            if (depth === 0 && type === 'moov')
                movie = true;
            if (depth === 0 && type === 'mdat' && size > header)
                media = true;
            if (containers.has(type) && !visit(offset + header, offset + size, depth + 1))
                return false;
            offset += size;
        }
        return true;
    };
    return visit(0, bytes.length, 0) && movie && media;
}

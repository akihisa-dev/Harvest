export const GIF_COLOR_TABLE_FLAG = 0x80;
export function gifColorTableSize(flags) {
    return flags & GIF_COLOR_TABLE_FLAG ? 3 * (1 << ((flags & 7) + 1)) : 0;
}
/** Share block bounds while letting dimension inspection and completeness enforce different policies. */
export function readGifSubBlocks(bytes, offset) {
    let dataSize = 0;
    while (offset < bytes.byteLength) {
        const size = bytes[offset++];
        if (size === 0)
            return { end: offset, dataSize };
        if (offset + size > bytes.byteLength)
            return null;
        dataSize += size;
        offset += size;
    }
    return null;
}

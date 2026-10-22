// IEEE CRC-32, shared by PNG chunks and ZIP entries. Eight lookup slices
// remove the byte-by-byte dependency without copying the input buffer.
const tables = (() => {
    const result = new Uint32Array(8 * 256);
    for (let index = 0; index < 256; index++) {
        let value = index;
        for (let bit = 0; bit < 8; bit++)
            value = (value >>> 1) ^ ((value & 1) ? 0xedb8_8320 : 0);
        result[index] = value >>> 0;
    }
    for (let slice = 1; slice < 8; slice++) {
        for (let index = 0; index < 256; index++) {
            const previous = result[(slice - 1) * 256 + index];
            result[slice * 256 + index] = (previous >>> 8) ^ result[previous & 0xff];
        }
    }
    return result;
})();
/** Extend an unfinalized CRC (initially 0xffffffff) across arbitrary stream chunks. */
export function updateCrc32(crc, bytes) {
    let index = 0;
    const end = bytes.length - bytes.length % 8;
    for (; index < end; index += 8) {
        const first = crc ^ bytes[index] ^ (bytes[index + 1] << 8)
            ^ (bytes[index + 2] << 16) ^ (bytes[index + 3] << 24);
        crc = tables[1792 + (first & 0xff)] ^ tables[1536 + ((first >>> 8) & 0xff)]
            ^ tables[1280 + ((first >>> 16) & 0xff)] ^ tables[1024 + (first >>> 24)]
            ^ tables[768 + bytes[index + 4]] ^ tables[512 + bytes[index + 5]]
            ^ tables[256 + bytes[index + 6]] ^ tables[bytes[index + 7]];
    }
    for (; index < bytes.length; index++)
        crc = (crc >>> 8) ^ tables[(crc ^ bytes[index]) & 0xff];
    return crc >>> 0;
}
export function crc32(bytes) {
    return (updateCrc32(0xffff_ffff, bytes) ^ 0xffff_ffff) >>> 0;
}

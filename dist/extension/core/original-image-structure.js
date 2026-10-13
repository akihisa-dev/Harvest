const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++)
        value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    return value >>> 0;
});
/** PNG chunk integrity only: keep originals independent from available pixel decoders. */
export function hasCompletePng(bytes) {
    if (![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value))
        return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let header = false, palette = false, data = 0, endedData = false, indexed = false;
    for (let offset = 8; offset < bytes.length;) {
        if (offset + 12 > bytes.length)
            return false;
        const size = view.getUint32(offset), end = offset + size + 12;
        if (end > bytes.length)
            return false;
        const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
        if (!/^[A-Za-z]{4}$/.test(type))
            return false;
        let crc = 0xffffffff;
        for (let i = offset + 4; i < end - 4; i++)
            crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 255];
        if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(end - 4))
            return false;
        if (!header && type !== "IHDR")
            return false;
        if (type === "IHDR") {
            if (header || size !== 13 || !view.getUint32(offset + 8) || !view.getUint32(offset + 12))
                return false;
            const depth = bytes[offset + 16], color = bytes[offset + 17];
            const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
            if (!depths[color]?.includes(depth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1)
                return false;
            indexed = color === 3;
            header = true;
        }
        else if (type === "PLTE") {
            if (palette || data || !size || size > 768 || size % 3)
                return false;
            palette = true;
        }
        else if (type === "IDAT") {
            if (endedData || (indexed && !palette))
                return false;
            data += size;
        }
        else if (type === "IEND")
            return size === 0 && data > 0;
        else if (data)
            endedData = true;
        offset = end;
    }
    return false;
}

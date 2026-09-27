/**
 * Returns a supported JPEG page without transcoding it, or null when the JPEG
 * is not a complete 8-bit three-component JFIF baseline/progressive image.
 */
export function getOriginalJpegPage(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
        return null;
    }
    const byte = (index) => bytes[index] ?? -1;
    let offset = 2;
    let hasJfif = false;
    let hasScan = false;
    let dimensions = null;
    while (offset < bytes.byteLength) {
        if (byte(offset++) !== 0xff)
            return null;
        while (offset < bytes.byteLength && byte(offset) === 0xff)
            offset += 1;
        if (offset >= bytes.byteLength)
            return null;
        const marker = byte(offset++);
        if (marker === 0xd9)
            break;
        if (marker === 0xda) {
            hasScan = true;
            for (let i = offset; i + 1 < bytes.byteLength; i += 1) {
                if (byte(i) === 0xff && byte(i + 1) === 0xd9)
                    return hasJfif && dimensions ? { jpeg: bytes, ...dimensions } : null;
            }
            return null;
        }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7))
            continue;
        if (offset + 2 > bytes.byteLength)
            return null;
        const length = (byte(offset) << 8) | byte(offset + 1);
        if (length < 2 || offset + length > bytes.byteLength)
            return null;
        const segmentStart = offset + 2;
        if (marker === 0xe0 && length >= 7 &&
            byte(segmentStart) === 0x4a && byte(segmentStart + 1) === 0x46 &&
            byte(segmentStart + 2) === 0x49 && byte(segmentStart + 3) === 0x46 &&
            byte(segmentStart + 4) === 0x00) {
            hasJfif = true;
        }
        if (marker === 0xe1 || marker === 0xe2 || marker === 0xee)
            return null;
        if ([0xc1, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker))
            return null;
        if (marker === 0xc0 || marker === 0xc2) {
            if (length < 8 || byte(segmentStart) !== 8 || byte(segmentStart + 5) !== 3)
                return null;
            const height = (byte(segmentStart + 1) << 8) | byte(segmentStart + 2);
            const width = (byte(segmentStart + 3) << 8) | byte(segmentStart + 4);
            if (width === 0 || height === 0)
                return null;
            dimensions = { width, height };
        }
        offset += length;
    }
    return hasScan && hasJfif && dimensions ? { jpeg: bytes, ...dimensions } : null;
}

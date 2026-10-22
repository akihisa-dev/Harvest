import { crc32 } from "./crc32.js";
/** PNG chunk integrity only: keep originals independent from available pixel decoders. */
export function hasCompletePng(bytes) {
    if (![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value))
        return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let width = 0, height = 0, declaredFrames = 0, frames = 0, sequence = 0, frameData = 0;
    let frameUsesIdat = false;
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
        if (crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4))
            return false;
        if (!header && type !== "IHDR")
            return false;
        if (type !== "IDAT" && data > 0)
            endedData = true;
        if (type === "IHDR") {
            if (header || size !== 13 || !view.getUint32(offset + 8) || !view.getUint32(offset + 12))
                return false;
            const depth = bytes[offset + 16], color = bytes[offset + 17];
            const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
            if (!depths[color]?.includes(depth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1)
                return false;
            width = view.getUint32(offset + 8);
            height = view.getUint32(offset + 12);
            indexed = color === 3;
            header = true;
        }
        else if (type === "acTL") {
            if (declaredFrames || data || size !== 8)
                return false;
            declaredFrames = view.getUint32(offset + 8);
            if (!declaredFrames)
                return false;
        }
        else if (type === "fcTL") {
            if (!declaredFrames || size !== 26 || (frames > 0 && frameData === 0)
                || view.getUint32(offset + 8) !== sequence++)
                return false;
            const w = view.getUint32(offset + 12), h = view.getUint32(offset + 16);
            const x = view.getUint32(offset + 20), y = view.getUint32(offset + 24);
            if (!w || !h || x + w > width || y + h > height
                || bytes[offset + 32] > 2 || bytes[offset + 33] > 1)
                return false;
            frameUsesIdat = data === 0;
            if (frameUsesIdat && (frames || x || y || w !== width || h !== height))
                return false;
            if (++frames > declaredFrames)
                return false;
            frameData = 0;
        }
        else if (type === "fdAT") {
            if (!declaredFrames || !frames || !data || frameUsesIdat || size < 4
                || view.getUint32(offset + 8) !== sequence++)
                return false;
            frameData += size - 4;
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
            if (frameUsesIdat)
                frameData += size;
        }
        else if (type === "IEND")
            return size === 0 && data > 0
                && (!declaredFrames || (frames === declaredFrames && frameData > 0));
        else if (data)
            endedData = true;
        offset = end;
    }
    return false;
}

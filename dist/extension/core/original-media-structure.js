import { GIF_COLOR_TABLE_FLAG, gifColorTableSize, readGifSubBlocks } from "./gif-blocks.js";
import { readIsoBox } from "./iso-boxes.js";
const GIF_TRAILER = 0x3b;
const GIF_EXTENSION = 0x21;
const GIF_IMAGE_DESCRIPTOR = 0x2c;
function readUint16LittleEndian(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
}
/** Validate container boundaries without decoding or changing original media bytes. */
export function hasCompleteGif(bytes) {
    const signature = String.fromCharCode(...bytes.subarray(0, 6));
    if (!["GIF87a", "GIF89a"].includes(signature) || bytes.length < 13)
        return false;
    const screenWidth = readUint16LittleEndian(bytes, 6);
    const screenHeight = readUint16LittleEndian(bytes, 8);
    if (!screenWidth || !screenHeight)
        return false;
    const screenFlags = bytes[10];
    let offset = 13 + gifColorTableSize(screenFlags);
    let frameCount = 0;
    while (offset < bytes.length) {
        const marker = bytes[offset++];
        if (marker === GIF_TRAILER)
            return frameCount > 0;
        if (marker === GIF_EXTENSION) {
            if (offset >= bytes.length)
                return false;
            offset += 1; // Extension label; unknown extensions remain forward compatible.
            const extensionData = readGifSubBlocks(bytes, offset);
            if (!extensionData)
                return false;
            offset = extensionData.end;
            continue;
        }
        if (marker !== GIF_IMAGE_DESCRIPTOR || offset + 9 > bytes.length)
            return false;
        const frameWidth = readUint16LittleEndian(bytes, offset + 4);
        const frameHeight = readUint16LittleEndian(bytes, offset + 6);
        if (!frameWidth || !frameHeight)
            return false;
        const imageFlags = bytes[offset + 8];
        if (!(screenFlags & GIF_COLOR_TABLE_FLAG) && !(imageFlags & GIF_COLOR_TABLE_FLAG))
            return false;
        offset += 9 + gifColorTableSize(imageFlags);
        if (offset >= bytes.length || bytes[offset] < 2 || bytes[offset] > 8)
            return false;
        offset += 1; // LZW minimum code size.
        const imageData = readGifSubBlocks(bytes, offset);
        if (!imageData || imageData.dataSize === 0)
            return false;
        offset = imageData.end;
        frameCount += 1;
    }
    return false;
}
/** Opaque boxes/codecs are allowed; known container boxes must fit their parent. */
export function hasCompleteMp4Boxes(bytes) {
    const containerTypes = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "mvex", "moof", "traf"]);
    let hasMovieBox = false;
    let hasMediaData = false;
    const validateBoxRange = (start, end, depth) => {
        if (depth > 16)
            return false;
        for (let offset = start; offset < end;) {
            const box = readIsoBox(bytes, offset, end);
            if (!box)
                return false;
            if (depth === 0 && box.type === "moov")
                hasMovieBox = true;
            if (depth === 0 && box.type === "mdat" && box.end > box.dataStart)
                hasMediaData = true;
            if (containerTypes.has(box.type) && !validateBoxRange(box.dataStart, box.end, depth + 1))
                return false;
            offset = box.end;
        }
        return true;
    };
    return validateBoxRange(0, bytes.length, 0) && hasMovieBox && hasMediaData;
}

/** Inspect WebP container bounds without allocating pixels or decoding frames. */
export function inspectWebpAnimation(bytes) {
    const text = (offset, value) => [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
    if (!text(0, "RIFF") || !text(8, "WEBP"))
        return null;
    if (bytes.length < 20)
        return "invalid";
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(4, true) + 8 !== bytes.length)
        return "invalid";
    let animationFlag = false, animationHeader = false, frames = 0, stillImage = false;
    for (let offset = 12; offset < bytes.length;) {
        if (offset + 8 > bytes.length)
            return "invalid";
        const size = view.getUint32(offset + 4, true);
        const start = offset + 8, end = start + size, next = end + (size % 2);
        if (next > bytes.length)
            return "invalid";
        if (text(offset, "VP8X")) {
            if (size !== 10)
                return "invalid";
            animationFlag ||= !!(bytes[start] & 2);
        }
        else if (text(offset, "ANIM")) {
            if (size !== 6)
                return "invalid";
            animationHeader = true;
        }
        else if (text(offset, "ANMF")) {
            if (size < 16)
                return "invalid";
            let frameImage = false;
            for (let inner = start + 16; inner < end;) {
                if (inner + 8 > end)
                    return "invalid";
                const innerSize = view.getUint32(inner + 4, true);
                const innerEnd = inner + 8 + innerSize + (innerSize % 2);
                if (innerEnd > end)
                    return "invalid";
                if (text(inner, "VP8 ") || text(inner, "VP8L"))
                    frameImage ||= innerSize > 0;
                inner = innerEnd;
            }
            if (!frameImage)
                return "invalid";
            frames++;
        }
        else if (text(offset, "VP8 ") || text(offset, "VP8L")) {
            stillImage ||= size > 0;
        }
        offset = next;
    }
    if (animationFlag || animationHeader || frames) {
        return animationFlag && animationHeader && frames > 0 && !stillImage ? "animated" : "invalid";
    }
    return stillImage ? "static" : "invalid";
}

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function hasAscii(bytes, offset, value) {
    if (offset < 0 || offset + value.length > bytes.byteLength)
        return false;
    for (let index = 0; index < value.length; index += 1) {
        if (bytes[offset + index] !== value.charCodeAt(index))
            return false;
    }
    return true;
}
function u16be(bytes, offset) {
    if (offset < 0 || offset + 2 > bytes.byteLength)
        return null;
    return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}
function u32be(bytes, offset) {
    if (offset < 0 || offset + 4 > bytes.byteLength)
        return null;
    return (((bytes[offset] ?? 0) * 0x1000000) +
        ((bytes[offset + 1] ?? 0) << 16) +
        ((bytes[offset + 2] ?? 0) << 8) +
        (bytes[offset + 3] ?? 0));
}
function u16le(bytes, offset) {
    if (offset < 0 || offset + 2 > bytes.byteLength)
        return null;
    return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}
function u24le(bytes, offset) {
    if (offset < 0 || offset + 3 > bytes.byteLength)
        return null;
    return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}
function u32le(bytes, offset) {
    if (offset < 0 || offset + 4 > bytes.byteLength)
        return null;
    return ((bytes[offset] ?? 0) +
        ((bytes[offset + 1] ?? 0) * 0x100) +
        ((bytes[offset + 2] ?? 0) * 0x10000) +
        ((bytes[offset + 3] ?? 0) * 0x1000000));
}
function pngDimensions(bytes) {
    if (bytes.byteLength < 24 || !pngSignature.every((value, index) => bytes[index] === value) ||
        u32be(bytes, 8) !== 13 || !hasAscii(bytes, 12, "IHDR"))
        return null;
    const width = u32be(bytes, 16);
    const height = u32be(bytes, 20);
    return width === null || height === null ? null : { width, height };
}
function jpegDimensions(bytes) {
    if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
        return null;
    const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset < bytes.byteLength) {
        if (bytes[offset] !== 0xff)
            return null;
        while (offset < bytes.byteLength && bytes[offset] === 0xff)
            offset += 1;
        if (offset >= bytes.byteLength)
            return null;
        const marker = bytes[offset++] ?? 0;
        if (marker === 0xd9 || marker === 0xda)
            return null;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7))
            continue;
        const length = u16be(bytes, offset);
        if (length === null || length < 2 || offset + length > bytes.byteLength)
            return null;
        if (startOfFrameMarkers.has(marker)) {
            if (length < 8)
                return null;
            const height = u16be(bytes, offset + 3);
            const width = u16be(bytes, offset + 5);
            return width === null || height === null ? null : { width, height };
        }
        offset += length;
    }
    return null;
}
function gifDimensions(bytes) {
    if (bytes.byteLength < 10 || (!hasAscii(bytes, 0, "GIF87a") && !hasAscii(bytes, 0, "GIF89a")))
        return null;
    const width = u16le(bytes, 6);
    const height = u16le(bytes, 8);
    if (width === null || height === null)
        return null;
    let maximumWidth = width;
    let maximumHeight = height;
    if (bytes.byteLength < 13)
        return { width: maximumWidth, height: maximumHeight };
    const logicalScreenFlags = bytes[10] ?? 0;
    let offset = 13;
    if ((logicalScreenFlags & 0x80) !== 0) {
        offset += 3 * (1 << ((logicalScreenFlags & 0x07) + 1));
    }
    while (offset < bytes.byteLength) {
        const marker = bytes[offset++] ?? 0;
        if (marker === 0x3b)
            break;
        if (marker === 0x21) {
            if (offset >= bytes.byteLength)
                break;
            offset += 1;
            offset = skipGifSubBlocks(bytes, offset) ?? bytes.byteLength;
            continue;
        }
        if (marker !== 0x2c || offset + 9 > bytes.byteLength)
            break;
        const left = u16le(bytes, offset) ?? 0;
        const top = u16le(bytes, offset + 2) ?? 0;
        const frameWidth = u16le(bytes, offset + 4) ?? 0;
        const frameHeight = u16le(bytes, offset + 6) ?? 0;
        maximumWidth = Math.max(maximumWidth, left + frameWidth);
        maximumHeight = Math.max(maximumHeight, top + frameHeight);
        const imageFlags = bytes[offset + 8] ?? 0;
        offset += 9;
        if ((imageFlags & 0x80) !== 0)
            offset += 3 * (1 << ((imageFlags & 0x07) + 1));
        if (offset >= bytes.byteLength)
            break;
        offset = skipGifSubBlocks(bytes, offset + 1) ?? bytes.byteLength;
    }
    return { width: maximumWidth, height: maximumHeight };
}
function skipGifSubBlocks(bytes, start) {
    let offset = start;
    while (offset < bytes.byteLength) {
        const size = bytes[offset++] ?? 0;
        if (size === 0)
            return offset;
        if (offset + size > bytes.byteLength)
            return null;
        offset += size;
    }
    return null;
}
function webpDimensions(bytes) {
    if (bytes.byteLength < 20 || !hasAscii(bytes, 0, "RIFF") || !hasAscii(bytes, 8, "WEBP"))
        return null;
    const riffSize = u32le(bytes, 4);
    if (riffSize === null || riffSize < 12 || riffSize + 8 > bytes.byteLength)
        return null;
    const end = riffSize + 8;
    let offset = 12;
    let extendedDimensions = null;
    let imageDimensions = null;
    while (offset + 8 <= end) {
        const size = u32le(bytes, offset + 4);
        if (size === null || size > end - offset - 8)
            return null;
        const data = offset + 8;
        if (hasAscii(bytes, offset, "VP8X") && size >= 10) {
            const width = u24le(bytes, data + 4);
            const height = u24le(bytes, data + 7);
            if (width !== null && height !== null)
                extendedDimensions = { width: width + 1, height: height + 1 };
        }
        else if (hasAscii(bytes, offset, "VP8 ") && size >= 10 &&
            bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
            const rawWidth = u16le(bytes, data + 6);
            const rawHeight = u16le(bytes, data + 8);
            if (rawWidth !== null && rawHeight !== null)
                imageDimensions = { width: rawWidth & 0x3fff, height: rawHeight & 0x3fff };
        }
        else if (hasAscii(bytes, offset, "VP8L") && size >= 5 && bytes[data] === 0x2f) {
            const b1 = bytes[data + 1] ?? 0;
            const b2 = bytes[data + 2] ?? 0;
            const b3 = bytes[data + 3] ?? 0;
            const b4 = bytes[data + 4] ?? 0;
            imageDimensions = {
                width: 1 + b1 + ((b2 & 0x3f) << 8),
                height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)),
            };
        }
        offset += 8 + size + (size & 1);
    }
    return extendedDimensions ?? imageDimensions;
}
function bmpDimensions(bytes) {
    if (bytes.byteLength < 26 || !hasAscii(bytes, 0, "BM"))
        return null;
    const headerSize = u32le(bytes, 14);
    if (headerSize === null)
        return null;
    if (headerSize === 12) {
        const width = u16le(bytes, 18);
        const height = u16le(bytes, 20);
        return width === null || height === null ? null : { width, height };
    }
    if (headerSize < 40 || bytes.byteLength < 26)
        return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getInt32(18, true);
    const signedHeight = view.getInt32(22, true);
    return { width, height: Math.abs(signedHeight) };
}
function isoBoxes(bytes, start, end) {
    const result = [];
    let offset = start;
    while (offset < end) {
        if (offset + 8 > end)
            return null;
        const size32 = u32be(bytes, offset);
        if (size32 === null)
            return null;
        let headerSize = 8;
        let size = size32;
        if (size32 === 1) {
            const high = u32be(bytes, offset + 8);
            const low = u32be(bytes, offset + 12);
            if (high === null || low === null || high > 0x1fffff)
                return null;
            size = high * 0x100000000 + low;
            headerSize = 16;
        }
        else if (size32 === 0) {
            size = end - offset;
        }
        if (size < headerSize || size > end - offset)
            return null;
        let type = "";
        for (let index = 0; index < 4; index += 1)
            type += String.fromCharCode(bytes[offset + 4 + index] ?? 0);
        result.push({ type, dataStart: offset + headerSize, end: offset + size });
        offset += size;
    }
    return offset === end ? result : null;
}
function avifDimensions(bytes) {
    const topLevel = isoBoxes(bytes, 0, bytes.byteLength);
    if (!topLevel)
        return null;
    const fileType = topLevel.find(box => box.type === "ftyp");
    if (!fileType || fileType.end - fileType.dataStart < 8)
        return null;
    const brands = [];
    for (let offset = fileType.dataStart; offset + 4 <= fileType.end; offset += 4) {
        let brand = "";
        for (let index = 0; index < 4; index += 1)
            brand += String.fromCharCode(bytes[offset + index] ?? 0);
        brands.push(brand);
    }
    if (!brands.some(brand => brand === "avif" || brand === "avis"))
        return null;
    const meta = topLevel.find(box => box.type === "meta");
    if (!meta || meta.dataStart + 4 > meta.end)
        return null;
    const metaChildren = isoBoxes(bytes, meta.dataStart + 4, meta.end);
    if (!metaChildren)
        return null;
    const primaryBox = metaChildren.find(box => box.type === "pitm");
    if (!primaryBox || primaryBox.dataStart + 4 > primaryBox.end)
        return null;
    const primaryVersion = bytes[primaryBox.dataStart] ?? 0;
    const primaryIdWidth = primaryVersion === 0 ? 2 : 4;
    if (primaryBox.dataStart + 4 + primaryIdWidth > primaryBox.end)
        return null;
    const primaryId = primaryVersion === 0
        ? u16be(bytes, primaryBox.dataStart + 4)
        : u32be(bytes, primaryBox.dataStart + 4);
    if (primaryId === null)
        return null;
    const itemProperties = metaChildren.find(box => box.type === "iprp");
    if (!itemProperties)
        return null;
    const propertyChildren = isoBoxes(bytes, itemProperties.dataStart, itemProperties.end);
    if (!propertyChildren)
        return null;
    const propertyContainer = propertyChildren.find(box => box.type === "ipco");
    if (!propertyContainer)
        return null;
    const properties = isoBoxes(bytes, propertyContainer.dataStart, propertyContainer.end);
    if (!properties)
        return null;
    const spatialExtents = [null];
    for (const property of properties) {
        if (property.type !== "ispe" || property.dataStart + 12 > property.end) {
            spatialExtents.push(null);
            continue;
        }
        const width = u32be(bytes, property.dataStart + 4);
        const height = u32be(bytes, property.dataStart + 8);
        spatialExtents.push(width === null || height === null ? null : { width, height });
    }
    for (const associationBox of propertyChildren.filter(box => box.type === "ipma")) {
        if (associationBox.dataStart + 8 > associationBox.end)
            return null;
        const version = bytes[associationBox.dataStart] ?? 0;
        const flags = ((bytes[associationBox.dataStart + 1] ?? 0) << 16) |
            ((bytes[associationBox.dataStart + 2] ?? 0) << 8) | (bytes[associationBox.dataStart + 3] ?? 0);
        const entryCount = u32be(bytes, associationBox.dataStart + 4);
        if (entryCount === null)
            return null;
        let offset = associationBox.dataStart + 8;
        for (let entry = 0; entry < entryCount; entry += 1) {
            const idWidth = version === 0 ? 2 : 4;
            if (offset + idWidth + 1 > associationBox.end)
                return null;
            const itemId = version === 0 ? u16be(bytes, offset) : u32be(bytes, offset);
            if (itemId === null)
                return null;
            offset += idWidth;
            const associationCount = bytes[offset++] ?? 0;
            let primaryDimensions = null;
            for (let index = 0; index < associationCount; index += 1) {
                const wide = (flags & 1) !== 0;
                if (offset + (wide ? 2 : 1) > associationBox.end)
                    return null;
                const association = wide ? u16be(bytes, offset) : bytes[offset] ?? null;
                if (association === null)
                    return null;
                offset += wide ? 2 : 1;
                const propertyIndex = wide ? association & 0x7fff : association & 0x7f;
                if (itemId === primaryId)
                    primaryDimensions ??= spatialExtents[propertyIndex] ?? null;
            }
            if (itemId === primaryId && primaryDimensions)
                return primaryDimensions;
        }
        if (offset !== associationBox.end)
            return null;
    }
    return null;
}
/** Read dimensions from image headers without asking a browser decoder to expand pixels. */
export function getImageDimensions(bytes) {
    if (!(bytes instanceof Uint8Array))
        return null;
    return pngDimensions(bytes) ?? jpegDimensions(bytes) ?? gifDimensions(bytes) ??
        webpDimensions(bytes) ?? bmpDimensions(bytes) ?? avifDimensions(bytes);
}

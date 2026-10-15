import { isoBoxes } from "./iso-boxes.js";
import { hasCompleteMp4Boxes } from "./original-media-structure.js";
/** Check image-item storage without decoding pixels or restricting the image codec. */
export function hasCompleteIsoImage(bytes) {
    try {
        const top = [...isoBoxes(bytes, 0, bytes.length)];
        const meta = top.find(box => box.type === "meta");
        const movie = top.find(box => box.type === "moov");
        if (movie && !hasCompleteMp4Boxes(bytes))
            return false;
        if (!meta)
            return !!movie && [...isoBoxes(bytes, movie.dataStart, movie.end)].some(box => box.type === "trak" && box.end > box.dataStart);
        if (meta.end - meta.dataStart < 4 || bytes[meta.dataStart] !== 0)
            return false;
        const children = [...isoBoxes(bytes, meta.dataStart + 4, meta.end)];
        for (const type of ["hdlr", "pitm", "iloc", "iinf", "iprp"]) {
            if (!children.some(box => box.type === type && box.end > box.dataStart))
                return false;
        }
        const properties = children.find(box => box.type === "iprp");
        const propertyBoxes = [...isoBoxes(bytes, properties.dataStart, properties.end)];
        const container = propertyBoxes.find(box => box.type === "ipco");
        if (!container || !propertyBoxes.some(box => box.type === "ipma"))
            return false;
        if (![...isoBoxes(bytes, container.dataStart, container.end)].length)
            return false;
        const idat = children.find(box => box.type === "idat");
        const media = top.filter(box => box.type === "mdat");
        return validItemLocations(bytes, children.find(box => box.type === "iloc"), media, idat);
    }
    catch {
        return false;
    }
}
function validItemLocations(bytes, box, media, idat) {
    let offset = box.dataStart;
    const read = (width) => {
        if (width > 8 || offset + width > box.end)
            throw new Error("Invalid item location");
        let value = 0;
        for (let index = 0; index < width; index++)
            value = value * 256 + bytes[offset++];
        if (!Number.isSafeInteger(value))
            throw new Error("Unsafe item location");
        return value;
    };
    const version = read(1);
    if (version > 2)
        return false;
    read(3); // FullBox flags.
    const sizes = read(1), baseAndIndex = read(1);
    const offsetSize = sizes >>> 4, lengthSize = sizes & 15, baseSize = baseAndIndex >>> 4;
    const indexSize = version ? baseAndIndex & 15 : 0;
    if ([offsetSize, lengthSize, baseSize, indexSize].some(size => size > 8))
        return false;
    const count = read(version < 2 ? 2 : 4);
    if (!count)
        return false;
    let storedExtents = 0;
    for (let item = 0; item < count; item++) {
        read(version < 2 ? 2 : 4); // item_ID
        const method = version ? read(2) & 15 : 0;
        if (method > 1 || read(2) !== 0)
            return false; // Originals must be self-contained.
        const base = read(baseSize), extents = read(2);
        if (!extents)
            return false;
        for (let extent = 0; extent < extents; extent++) {
            read(indexSize);
            const start = base + read(offsetSize), length = read(lengthSize);
            const ranges = method === 1 ? (idat ? [idat] : []) : media;
            if (!ranges.some(range => {
                const absolute = method === 1 ? range.dataStart + start : start;
                return Number.isSafeInteger(absolute + length) && absolute >= range.dataStart &&
                    absolute < range.end && (length === 0 || absolute + length <= range.end);
            }))
                return false;
            storedExtents++;
        }
    }
    return offset === box.end && storedExtents > 0;
}

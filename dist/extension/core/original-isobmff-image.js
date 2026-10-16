import { isoBoxes } from "./iso-boxes.js";
import { hasCompleteImageTracks } from "./original-image-tracks.js";
import { hasCompleteMp4Boxes } from "./original-media-structure.js";
/** Check image-item storage without decoding pixels or restricting the image codec. */
export function hasCompleteIsoImage(bytes) {
    try {
        const top = selectedBoxes(bytes, 0, bytes.length, ["meta", "moov"]);
        const meta = top.get("meta"), movie = top.get("moov");
        if (movie && (!hasCompleteMp4Boxes(bytes) || !hasCompleteImageTracks(bytes, movie)))
            return false;
        if (!meta) {
            if (!movie)
                return false;
            return selectedBoxes(bytes, movie.dataStart, movie.end, ["trak"]).has("trak");
        }
        if (meta.end - meta.dataStart < 4 || bytes[meta.dataStart] !== 0)
            return false;
        const children = selectedBoxes(bytes, meta.dataStart + 4, meta.end, ["hdlr", "pitm", "iloc", "iinf", "iprp", "idat"]);
        for (const type of ["hdlr", "pitm", "iloc", "iinf", "iprp"]) {
            const child = children.get(type);
            if (!child || child.end === child.dataStart)
                return false;
        }
        const properties = children.get("iprp");
        const propertyBoxes = selectedBoxes(bytes, properties.dataStart, properties.end, ["ipco", "ipma"]);
        const container = propertyBoxes.get("ipco");
        if (!container || !propertyBoxes.has("ipma"))
            return false;
        let hasProperty = false;
        for (const _box of isoBoxes(bytes, container.dataStart, container.end))
            hasProperty = true;
        if (!hasProperty)
            return false;
        return validItemLocations(bytes, children.get("iloc"), children.get("idat"));
    }
    catch {
        return false;
    }
}
/** Retain at most one box per requested type; still validate the entire range. */
function selectedBoxes(bytes, start, end, types) {
    const selected = new Map();
    for (const box of isoBoxes(bytes, start, end))
        if (types.includes(box.type) && !selected.has(box.type))
            selected.set(box.type, box);
    return selected;
}
function validItemLocations(bytes, box, idat) {
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
            const fits = (range) => {
                const absolute = method === 1 ? range.dataStart + start : start;
                return Number.isSafeInteger(absolute + length) && absolute >= range.dataStart &&
                    absolute < range.end && (length === 0 || absolute + length <= range.end);
            };
            let stored = method === 1 && !!idat && fits(idat);
            if (method === 0) {
                for (const range of isoBoxes(bytes, 0, bytes.length)) {
                    if (range.type === "mdat" && fits(range)) {
                        stored = true;
                        break;
                    }
                }
            }
            if (!stored)
                return false;
            storedExtents++;
        }
    }
    return offset === box.end && storedExtents > 0;
}

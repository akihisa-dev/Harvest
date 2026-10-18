import { isoBoxes } from "./iso-boxes.js";
function children(bytes, parent, types) {
    const result = new Map();
    for (const box of isoBoxes(bytes, parent.dataStart, parent.end)) {
        if (!types.includes(box.type))
            continue;
        if (result.has(box.type))
            throw new Error("Duplicate image track table");
        result.set(box.type, box);
    }
    return result;
}
function required(boxes, type) {
    const box = boxes.get(type);
    if (!box)
        throw new Error("Missing image track table");
    return box;
}
function reader(bytes, box) {
    return (relative, width = 4) => {
        const start = box.dataStart + relative;
        if (relative < 0 || start + width > box.end)
            throw new Error("Truncated image track table");
        let value = 0;
        for (let offset = start; offset < start + width; offset++)
            value = value * 256 + bytes[offset];
        if (!Number.isSafeInteger(value))
            throw new Error("Unsafe image track offset");
        return value;
    };
}
/** Validate declared samples without retaining per-sample or per-chunk objects. */
export function hasCompleteImageTracks(bytes, movie, containsMedia) {
    let tracks = 0;
    for (const track of isoBoxes(bytes, movie.dataStart, movie.end)) {
        if (track.type !== "trak")
            continue;
        tracks++;
        const media = required(children(bytes, track, ["mdia"]), "mdia");
        const info = required(children(bytes, media, ["minf"]), "minf");
        const table = required(children(bytes, info, ["stbl"]), "stbl");
        if (!validSamples(bytes, table, containsMedia))
            return false;
    }
    return tracks > 0;
}
function validSamples(bytes, table, containsMedia) {
    const boxes = children(bytes, table, ["stsz", "stz2", "stsc", "stco", "co64", "stts"]);
    if (boxes.has("stsz") === boxes.has("stz2") || boxes.has("stco") === boxes.has("co64"))
        return false;
    const sizes = boxes.get("stsz") ?? required(boxes, "stz2");
    const offsets = boxes.get("stco") ?? required(boxes, "co64");
    const mapping = required(boxes, "stsc"), timing = required(boxes, "stts");
    for (const box of [sizes, offsets, mapping, timing])
        if (reader(bytes, box)(0) !== 0)
            return false;
    const size = reader(bytes, sizes), offset = reader(bytes, offsets), map = reader(bytes, mapping), time = reader(bytes, timing);
    const sampleCount = size(8), fixedSize = sizes.type === "stsz" ? size(4) : 0;
    const field = sizes.type === "stz2" ? size(7, 1) : 32;
    if (!sampleCount || !(sizes.type === "stz2" ? [4, 8, 16] : [32]).includes(field))
        return false;
    const sizeBytes = sizes.type === "stsz" && fixedSize ? 0 : Math.ceil(sampleCount * field / 8);
    if (sizes.end - sizes.dataStart !== 12 + sizeBytes)
        return false;
    const sampleSize = (index) => {
        if (fixedSize)
            return fixedSize;
        if (field === 4) {
            const value = size(12 + Math.floor(index / 2), 1);
            return index % 2 ? value & 15 : value >>> 4;
        }
        return size(12 + index * (field / 8), field / 8);
    };
    const chunkCount = offset(4), offsetWidth = offsets.type === "co64" ? 8 : 4;
    const mapCount = map(4), timeCount = time(4);
    if (!chunkCount || !mapCount || offsets.end - offsets.dataStart !== 8 + chunkCount * offsetWidth
        || mapping.end - mapping.dataStart !== 8 + mapCount * 12
        || timing.end - timing.dataStart !== 8 + timeCount * 8)
        return false;
    let timedSamples = 0;
    for (let index = 0; index < timeCount; index++)
        timedSamples += time(8 + index * 8);
    if (timedSamples !== sampleCount)
        return false;
    let previous = 0;
    for (let index = 0; index < mapCount; index++) {
        const first = map(8 + index * 12);
        if (first <= previous || first > chunkCount || (!index && first !== 1)
            || !map(12 + index * 12) || !map(16 + index * 12))
            return false;
        previous = first;
    }
    let entry = 0, sample = 0;
    for (let chunk = 1; chunk <= chunkCount; chunk++) {
        if (entry + 1 < mapCount && chunk === map(8 + (entry + 1) * 12))
            entry++;
        const count = map(12 + entry * 12);
        if (count > sampleCount - sample)
            return false;
        let length = 0;
        for (let index = 0; index < count; index++) {
            const value = sampleSize(sample++);
            if (!value)
                return false;
            length += value;
        }
        if (!containsMedia(offset(8 + (chunk - 1) * offsetWidth, offsetWidth), length))
            return false;
    }
    return sample === sampleCount;
}

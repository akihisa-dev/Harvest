import { isoBoxes } from "./iso-boxes.js";
/** Index only nonempty mdat bounds, with packed storage instead of box objects. */
export function indexMediaRanges(bytes) {
    let count = 0;
    for (const box of isoBoxes(bytes, 0, bytes.length))
        if (box.type === "mdat" && box.end > box.dataStart)
            count++;
    // Two linear passes allocate exactly 16 bytes per nonempty mdat. No free box,
    // item extent or sample object is retained; the index is bounded by input size.
    const ranges = new Float64Array(count * 2);
    let at = 0;
    for (const box of isoBoxes(bytes, 0, bytes.length)) {
        if (box.type !== "mdat" || box.end === box.dataStart)
            continue;
        ranges[at++] = box.dataStart;
        ranges[at++] = box.end;
    }
    return (start, length) => {
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(start + length))
            return false;
        let low = 0, high = count;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (ranges[middle * 2] <= start)
                low = middle + 1;
            else
                high = middle;
        }
        if (!low)
            return false;
        const end = ranges[(low - 1) * 2 + 1];
        return start < end && start + length <= end;
    };
}

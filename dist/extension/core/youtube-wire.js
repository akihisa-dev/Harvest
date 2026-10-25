import { MAX_MEDIA_BYTES } from "./media-limits.js";
const malformed = () => new Error("YouTubeの配信データが不完全または未対応です。");
export function readWire(bytes) {
    if (bytes.length > 65536)
        throw malformed();
    let offset = 0;
    const integer = () => {
        let value = 0n;
        for (let shift = 0; shift < 70; shift += 7) {
            if (offset >= bytes.length)
                throw malformed();
            const byte = bytes[offset++];
            if (shift === 63 && byte > 1)
                throw malformed();
            value |= BigInt(byte & 127) << BigInt(shift);
            if (byte < 128)
                return value;
        }
        throw malformed();
    };
    const fields = [];
    while (offset < bytes.length) {
        if (fields.length >= 2048)
            throw malformed();
        const start = offset, tag = integer();
        if (tag > 0xffffffffn || tag < 8n)
            throw malformed();
        const id = Number(tag >> 3n), wire = Number(tag & 7n);
        let value;
        if (wire === 0)
            value = integer();
        else {
            const size = wire === 2 ? Number(integer()) : wire === 1 ? 8 : wire === 5 ? 4 : -1;
            if (!Number.isSafeInteger(size) || size < 0 || size > bytes.length - offset)
                throw malformed();
            value = bytes.subarray(offset, offset + size);
            offset += size;
        }
        fields.push({ id, wire, value, raw: bytes.subarray(start, offset) });
    }
    return fields;
}
export function wireBytes(fields, id) {
    const found = fields.filter(field => field.id === id);
    if (found.length > 1 || (found[0] && found[0].wire !== 2))
        throw malformed();
    return found[0]?.value;
}
export function wireNumber(fields, id, fallback = 0) {
    const found = fields.filter(field => field.id === id);
    if (found.length > 1 || (found[0] && found[0].wire !== 0))
        throw malformed();
    if (!found[0])
        return fallback;
    const value = Number(found[0].value);
    if (!Number.isSafeInteger(value) || value < 0)
        throw malformed();
    return value;
}
export function wireText(fields, id) {
    const data = wireBytes(fields, id);
    return data ? new TextDecoder("utf-8", { fatal: true }).decode(data) : "";
}
export function joinBytes(parts) {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    if (!Number.isSafeInteger(size) || size > MAX_MEDIA_BYTES)
        throw malformed();
    const result = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}
function varint(value) {
    if (value < 0n || value > 0xffffffffffffffffn)
        throw malformed();
    const bytes = [];
    do {
        bytes.push(Number(value & 127n) | (value > 127n ? 128 : 0));
        value >>= 7n;
    } while (value);
    return new Uint8Array(bytes);
}
export function encodeNumber(id, value) {
    return joinBytes([varint(BigInt(id) * 8n), varint(BigInt(value))]);
}
export function encodeBytes(id, value) {
    return joinBytes([varint(BigInt(id) * 8n + 2n), varint(BigInt(value.length)), value]);
}
export function encodeText(id, value) { return encodeBytes(id, new TextEncoder().encode(value)); }
export function replaceWire(original, replacements) {
    return joinBytes([...readWire(original).filter(f => !replacements.has(f.id)).map(f => f.raw), ...[...replacements.values()].flat()]);
}
/** UMP's prefix integers are not protobuf varints. Reject truncated parts before consuming any media. */
export function* readUmp(bytes, maxPartBytes) {
    let offset = 0, count = 0;
    const integer = () => {
        if (offset >= bytes.length)
            throw malformed();
        const first = bytes[offset++];
        const length = first < 128 ? 1 : first < 192 ? 2 : first < 224 ? 3 : first < 240 ? 4 : 5;
        if (length - 1 > bytes.length - offset)
            throw malformed();
        if (length === 1)
            return first;
        const bits = length === 5 ? 0 : 8 - length;
        let value = length === 5 ? 0 : first & ((1 << bits) - 1), multiplier = 2 ** bits;
        for (let index = 1; index < length; index++) {
            value += bytes[offset++] * multiplier;
            multiplier *= 256;
        }
        return value;
    };
    while (offset < bytes.length) {
        if (++count > 100000)
            throw malformed();
        const type = integer(), size = integer();
        if (size > maxPartBytes || size > bytes.length - offset)
            throw malformed();
        yield { type, data: bytes.subarray(offset, offset + size) };
        offset += size;
    }
}

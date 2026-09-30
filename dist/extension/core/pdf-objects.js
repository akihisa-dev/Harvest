const textEncoder = new TextEncoder();
const PDF_HEADER_1_3 = new Uint8Array([
    0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x33, 0x0a,
    0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
]);
const PDF_HEADER_1_5 = new Uint8Array([
    0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35, 0x0a,
    0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
]);
export function pdfText(value) {
    return textEncoder.encode(value);
}
export function pdfHex(value) {
    let hex = "";
    for (let index = 0; index < value.length; index += 1) {
        hex += value.charCodeAt(index).toString(16).padStart(4, "0");
    }
    return `<${hex}>`;
}
export function pdfAsciiHex(value) {
    let hex = "";
    for (let index = 0; index < value.length; index += 1) {
        hex += value.charCodeAt(index).toString(16).padStart(2, "0");
    }
    return `<${hex}>`;
}
export function joinChunks(chunks, totalLength) {
    const output = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return output;
}
export function pdfStreamObject(header, data, suffix = "endstream\nendobj\n") {
    const chunks = pdfStreamObjectParts(header, data, suffix);
    return joinChunks(chunks, chunks.reduce((length, chunk) => length + chunk.byteLength, 0));
}
/** Keeps stream data as separate parts until a caller chooses the final output format. */
export function pdfStreamObjectParts(header, data, suffix = "endstream\nendobj\n") {
    return [pdfText(header), data, pdfText(suffix)];
}
/** Serializes one-based PDF objects as byte parts and builds matching xref offsets. */
export function serializePdfDocumentParts(objects, hasSourcePage) {
    const objectCount = objects.length;
    const offsets = new Array(objectCount + 1).fill(0);
    const pdfHeader = hasSourcePage ? PDF_HEADER_1_5 : PDF_HEADER_1_3;
    const chunks = [pdfHeader];
    let cursor = pdfHeader.byteLength;
    for (const [index, object] of objects.entries()) {
        offsets[index + 1] = cursor;
        for (const part of object) {
            chunks.push(part);
            cursor += part.byteLength;
        }
    }
    const xref = [
        `xref\n0 ${objectCount + 1}\n`,
        "0000000000 65535 f \n",
        ...offsets.slice(1).map(offset => `${offset.toString().padStart(10, "0")} 00000 n \n`),
        `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${cursor}\n%%EOF\n`,
    ].join("");
    const xrefBytes = pdfText(xref);
    chunks.push(xrefBytes);
    return chunks;
}
/** Serializes objects contiguously for the legacy Uint8Array API. */
export function serializePdfDocument(objects, hasSourcePage) {
    const objectParts = objects.map(object => object instanceof Uint8Array ? [object] : object);
    const chunks = serializePdfDocumentParts(objectParts, hasSourcePage);
    const totalLength = chunks.reduce((length, chunk) => length + chunk.byteLength, 0);
    return joinChunks(chunks, totalLength);
}

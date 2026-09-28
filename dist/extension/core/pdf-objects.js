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
    const headerBytes = pdfText(header);
    const suffixBytes = pdfText(suffix);
    return joinChunks([headerBytes, data, suffixBytes], headerBytes.byteLength + data.byteLength + suffixBytes.byteLength);
}
/** Serializes a contiguous, one-based object list and builds the matching xref table. */
export function serializePdfDocument(objects, hasSourcePage) {
    const objectCount = objects.length;
    const offsets = new Array(objectCount + 1).fill(0);
    const pdfHeader = hasSourcePage ? PDF_HEADER_1_5 : PDF_HEADER_1_3;
    const chunks = [pdfHeader, ...objects];
    let totalLength = pdfHeader.byteLength;
    for (const object of objects)
        totalLength += object.byteLength;
    let cursor = pdfHeader.byteLength;
    for (const [index, object] of objects.entries()) {
        offsets[index + 1] = cursor;
        cursor += object.byteLength;
    }
    const xref = [
        `xref\n0 ${objectCount + 1}\n`,
        "0000000000 65535 f \n",
        ...offsets.slice(1).map(offset => `${offset.toString().padStart(10, "0")} 00000 n \n`),
        `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${cursor}\n%%EOF\n`,
    ].join("");
    const xrefBytes = pdfText(xref);
    chunks.push(xrefBytes);
    totalLength += xrefBytes.byteLength;
    return joinChunks(chunks, totalLength);
}

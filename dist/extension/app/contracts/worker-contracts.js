// Structured cloning does not validate a payload. Both endpoints must narrow unknown data.
function record(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function workerRequestId(value) {
    if (!record(value))
        return null;
    const id = value["id"];
    return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}
function failure(value, result) {
    return typeof value["error"] === "string" && value["error"].length > 0 && value[result] === undefined;
}
export function isJxlEncodeRequest(value) {
    if (!record(value) || workerRequestId(value) === null)
        return false;
    const width = value["width"], height = value["height"], pixels = value["pixels"];
    return typeof width === "number" && typeof height === "number"
        && Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
        && Number.isSafeInteger(width * height * 4)
        && pixels instanceof ArrayBuffer && pixels.byteLength === width * height * 4;
}
export function isJxlEncodeReply(value) {
    if (!record(value) || workerRequestId(value) === null)
        return false;
    return failure(value, "buffer") || (value["error"] === undefined
        && value["buffer"] instanceof ArrayBuffer && value["buffer"].byteLength > 0);
}
export function isMp4ConversionRequest(value) {
    if (!record(value))
        return false;
    return value["blob"] instanceof Blob && value["blob"].type === "video/webm" && value["blob"].size > 0
        && typeof value["maxBytes"] === "number" && Number.isSafeInteger(value["maxBytes"]) && value["maxBytes"] > 0;
}
export function isMp4ConversionReply(value) {
    if (!record(value))
        return false;
    return failure(value, "blob") || (value["error"] === undefined && value["blob"] instanceof Blob
        && value["blob"].type === "video/mp4" && value["blob"].size > 0);
}
export function isZipChecksumRequest(value) {
    return record(value) && workerRequestId(value) !== null && value["blob"] instanceof Blob;
}
export function isZipChecksumReply(value) {
    if (!record(value) || workerRequestId(value) === null)
        return false;
    const checksum = value["checksum"];
    return failure(value, "checksum") || (value["error"] === undefined && typeof checksum === "number"
        && Number.isInteger(checksum) && checksum >= 0 && checksum <= 0xffff_ffff);
}

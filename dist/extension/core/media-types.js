function ascii(bytes, start, end) {
    return String.fromCharCode(...bytes.subarray(start, end));
}
function uint32be(bytes, offset) {
    return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}
function hasPrefix(bytes, signature) {
    return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}
function ftypBrands(bytes) {
    if (bytes.length < 16 || ascii(bytes, 4, 8) !== "ftyp")
        return [];
    const size32 = uint32be(bytes, 0);
    let boxSize = size32;
    let majorBrandOffset = 8;
    let compatibleBrandsOffset = 16;
    if (size32 === 1) {
        if (bytes.length < 24 || uint32be(bytes, 8) !== 0)
            return [];
        boxSize = uint32be(bytes, 12);
        majorBrandOffset = 16;
        compatibleBrandsOffset = 24;
    }
    if (boxSize < compatibleBrandsOffset || boxSize > bytes.length || (boxSize - compatibleBrandsOffset) % 4 !== 0)
        return [];
    const brands = [ascii(bytes, majorBrandOffset, majorBrandOffset + 4)];
    // The ftyp box should be small. Bound inspection even if its declared size is hostile.
    const inspectionEnd = Math.min(boxSize, 4 * 1024);
    for (let index = compatibleBrandsOffset; index + 4 <= inspectionEnd; index += 4) {
        brands.push(ascii(bytes, index, index + 4));
    }
    return brands;
}
function hasAnyFtypBrand(bytes, accepted) {
    const brands = ftypBrands(bytes);
    return brands.length > 0 && brands.some(brand => accepted.includes(brand));
}
const mediaTypes = {
    "image/jpeg": { extension: "jpg", kind: "image", matches: bytes => hasPrefix(bytes, [0xff, 0xd8, 0xff]) },
    "image/png": { extension: "png", kind: "image", matches: bytes => hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
    "image/gif": { extension: "gif", kind: "gif", matches: bytes => ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a" },
    "image/webp": { extension: "webp", kind: "image", matches: bytes => bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP" },
    "image/jxl": { extension: "jxl", kind: "image", matches: bytes => hasPrefix(bytes, [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]) || hasPrefix(bytes, [0xff, 0x0a]) },
    "image/avif": { extension: "avif", kind: "image", matches: bytes => hasAnyFtypBrand(bytes, ["avif", "avis"]) },
    "image/heic": { extension: "heic", kind: "image", matches: bytes => hasAnyFtypBrand(bytes, ["heic", "heix", "hevc", "hevx", "mif1", "msf1"]) },
    "image/heif": { extension: "heif", kind: "image", matches: bytes => hasAnyFtypBrand(bytes, ["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis"]) },
    "image/bmp": { extension: "bmp", kind: "image", matches: bytes => hasPrefix(bytes, [0x42, 0x4d]) },
    "image/tiff": { extension: "tif", kind: "image", matches: bytes => hasPrefix(bytes, [0x49, 0x49, 0x2a, 0x00]) || hasPrefix(bytes, [0x4d, 0x4d, 0x00, 0x2a]) },
    "video/mp4": { extension: "mp4", kind: "video", matches: bytes => hasAnyFtypBrand(bytes, ["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "mp71", "avc1", "M4V ", "M4VP", "MSNV", "dash", "3gp4", "3gp5", "3gp6", "3g2a", "F4V "]) },
    "video/webm": { extension: "webm", kind: "video", matches: bytes => hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3]) },
};
export function normalizeMediaMimeType(mimeType) {
    return mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}
export function originalMediaType(mimeType) {
    return mediaTypes[normalizeMediaMimeType(mimeType)];
}
/** Legacy still-image items also accept GIF; explicit GIF/video items stay strict. */
export function mediaTypeMatchesKind(kind, mediaKind) {
    if (kind === "video")
        return mediaKind === "video";
    if (kind === "gif")
        return mediaKind === "gif";
    return mediaKind === "image" || mediaKind === "gif";
}

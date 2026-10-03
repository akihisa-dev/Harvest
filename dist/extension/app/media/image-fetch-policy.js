/** Raised when an image URL would make a cross-origin request to a local host. */
export class ImageFetchTargetError extends Error {
    constructor() {
        super("この画像URLは安全性を確認できないため取得できません。");
        this.name = "ImageFetchTargetError";
    }
}
function webUrl(value) {
    if (!value)
        return null;
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? url : null;
    }
    catch {
        return null;
    }
}
/** Use Chrome's signed-in state only when page and image have the exact same origin. */
export function getImageFetchCredentials(imageUrl, sourcePage) {
    const image = webUrl(imageUrl);
    const source = webUrl(sourcePage);
    return image && source && image.origin === source.origin ? "include" : "omit";
}
/** Require public DNS results for URL hosts that are not already known to be local. */
export function getImageFetchTargetAddressSpace(imageUrl) {
    const image = webUrl(imageUrl);
    return image && !isLocalHost(image) ? "public" : undefined;
}
function isPrivateIpv4(host) {
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host))
        return false;
    const parts = host.split(".").map(Number);
    if (parts.some(part => part < 0 || part > 255))
        return false;
    const [firstOctet = 0, secondOctet = 0] = parts;
    return firstOctet === 0 || firstOctet === 10 || firstOctet === 127 ||
        (firstOctet === 100 && secondOctet >= 64 && secondOctet <= 127) ||
        (firstOctet === 169 && secondOctet === 254) ||
        (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) ||
        (firstOctet === 192 && secondOctet === 168) ||
        (firstOctet === 198 && (secondOctet === 18 || secondOctet === 19)) ||
        firstOctet >= 224;
}
function ipv6Value(hostname) {
    let value = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!value.includes(":"))
        return null;
    const embeddedIpv4 = value.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (embeddedIpv4) {
        if (!isPrivateIpv4(embeddedIpv4))
            return null;
        const octets = embeddedIpv4.split(".").map(Number);
        value = value.slice(0, -embeddedIpv4.length) + `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    }
    const halves = value.split("::");
    if (halves.length > 2)
        return null;
    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    const missing = 8 - left.length - right.length;
    if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1))
        return null;
    const words = [...left, ...Array.from({ length: Math.max(0, missing) }, () => "0"), ...right];
    if (words.length !== 8 || words.some(word => !/^[\da-f]{1,4}$/.test(word)))
        return null;
    return words.reduce((result, word) => (result << 16n) | BigInt(`0x${word}`), 0n);
}
function isPrivateIpv6(hostname) {
    const value = ipv6Value(hostname);
    if (value === null)
        return false;
    const first = Number((value >> 112n) & 0xffffn);
    if (value === 0n || value === 1n)
        return true;
    if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80)
        return true;
    // IPv4-mapped IPv6 addresses retain the IPv4 address in their final 32 bits.
    if ((value >> 32n) === 0xffffn) {
        const ipv4 = Number(value & 0xffffffffn);
        const host = [ipv4 >>> 24, (ipv4 >>> 16) & 255, (ipv4 >>> 8) & 255, ipv4 & 255].join(".");
        return isPrivateIpv4(host);
    }
    return false;
}
function isLocalHost(url) {
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
        isPrivateIpv4(host) || isPrivateIpv6(url.hostname);
}
/** Reject page-supplied image URLs that cross from a public page into a local network. */
export function validateImageFetchTarget(imageUrl, sourcePage) {
    const image = webUrl(imageUrl);
    if (!image || image.username || image.password)
        throw new ImageFetchTargetError();
    const source = webUrl(sourcePage);
    if (isLocalHost(image) && image.origin !== source?.origin)
        throw new ImageFetchTargetError();
}

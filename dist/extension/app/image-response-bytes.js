import { IMAGE_TOO_LARGE_MESSAGE, invalidImage, MAX_IMAGE_BYTES } from "./image-data-contract.js";
import { cancelResponse } from "./response-fetch.js";
function contentLength(response) {
    const value = response.headers.get("content-length")?.trim();
    if (!value || !/^\d+$/.test(value))
        return undefined;
    const length = Number(value);
    return Number.isSafeInteger(length) ? length : undefined;
}
/** Read an image response with a hard byte ceiling; the optional limit can only tighten it. */
export async function readImageBytes(response, requestedLimit = MAX_IMAGE_BYTES) {
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit <= 0) {
        throw new RangeError("requestedLimit must be a positive safe integer.");
    }
    const limit = Math.min(requestedLimit, MAX_IMAGE_BYTES);
    const declaredLength = contentLength(response);
    if (declaredLength !== undefined && declaredLength > limit) {
        void cancelResponse(response);
        throw invalidImage(IMAGE_TOO_LARGE_MESSAGE);
    }
    const body = response.body;
    if (!body) {
        // Real fetch responses expose a stream. Keep support for body-less test and
        // embedding responses, while still rejecting them once their size is known.
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > limit)
            throw invalidImage(IMAGE_TOO_LARGE_MESSAGE);
        return bytes;
    }
    const reader = body.getReader();
    const chunks = [];
    let length = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            if (value.byteLength > limit - length) {
                void reader.cancel().catch(() => { });
                throw invalidImage(IMAGE_TOO_LARGE_MESSAGE);
            }
            chunks.push(value);
            length += value.byteLength;
        }
    }
    finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}

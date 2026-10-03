import { BlobSource, EncodedPacketSink, Input, MP4 } from "./vendor/mediabunny/index.js";
import { hasCompleteGif, hasCompleteMp4Boxes } from "../core/original-media-structure.js";
import { checkCancelled, invalidImage } from "./image-data-contract.js";
// Blob bytes are immutable. Remember only completed successes by weak identity.
const validatedMedia = new WeakSet();
/** Inspect structure and declared samples without codec support requirements or re-encoding. */
export async function validateOriginalMedia(blob, signal) {
    if (blob.type !== "image/gif" && blob.type !== "video/mp4")
        return;
    checkCancelled(signal);
    if (validatedMedia.has(blob))
        return;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    checkCancelled(signal);
    const invalid = () => invalidImage("メディアのデータが不完全または破損しています。");
    if (blob.type === "image/gif") {
        if (!hasCompleteGif(bytes))
            throw invalid();
        checkCancelled(signal);
        validatedMedia.add(blob);
        return;
    }
    if (!hasCompleteMp4Boxes(bytes))
        throw invalid();
    const input = new Input({ formats: [MP4], source: new BlobSource(blob) });
    try {
        const video = await input.getPrimaryVideoTrack();
        if (!video)
            throw invalid();
        for (const track of await input.getTracks()) {
            const sink = new EncodedPacketSink(track);
            let previousDeclaredPacket;
            let trackBytes = 0;
            // Metadata iteration does not stop silently when a declared sample is outside the file.
            for await (const declared of sink.packets(undefined, undefined, { metadataOnly: true })) {
                checkCancelled(signal);
                const packet = previousDeclaredPacket ? await sink.getNextPacket(previousDeclaredPacket) : await sink.getFirstPacket();
                if (!packet || packet.data.byteLength !== declared.byteLength)
                    throw invalid();
                trackBytes += packet.data.byteLength;
                previousDeclaredPacket = declared;
            }
            if (track === video && !trackBytes)
                throw invalid();
        }
    }
    catch (error) {
        checkCancelled(signal);
        throw invalid();
    }
    finally {
        input.dispose();
    }
    checkCancelled(signal);
    validatedMedia.add(blob);
}

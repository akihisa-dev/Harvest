import {normalizeMediaMimeType} from "../../core/media-types.js";
import {BufferSource, EncodedPacketSink, Input, MP4} from "harvest-vendor-mediabunny";
import {hasCompleteGif, hasCompleteMp4Boxes} from "../../core/original-media-structure.js";
import {indexMediaRanges} from "../../core/iso-media-ranges.js";
import {inspectJpegStructure} from "../../core/jpeg.js";
import {hasCompletePng} from "../../core/original-image-structure.js";
import {validateWebm} from "./webm-validation.js";
import {inspectWebpAnimation} from "../../core/webp-animation.js";
import {validateIsoImage} from "./iso-image-validation.js";
import {checkCancelled, invalidImage} from "../contracts/image-data-contract.js";

// Blob bytes are immutable. Remember only completed successes by weak identity.
const validatedMedia = new WeakSet<Blob>();

/** Inspect structure and declared samples without codec support requirements or re-encoding. */
export async function validateOriginalMedia(blob: Blob, signal?: AbortSignal): Promise<void> {
  const mimeType = normalizeMediaMimeType(blob.type);
  if (!["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/heic", "image/heif", "video/mp4", "video/webm"].includes(mimeType)) return;
  checkCancelled(signal);
  if (validatedMedia.has(blob)) return;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  checkCancelled(signal);
  const invalid = (): Error => invalidImage("メディアのデータが不完全または破損しています。");
  if (mimeType !== "video/mp4") {
    const valid = mimeType === "image/jpeg" ? inspectJpegStructure(bytes)
      : mimeType === "image/png" ? hasCompletePng(bytes)
        : mimeType === "video/webm" ? await validateWebm(bytes, signal)
          : mimeType === "image/webp" ? ["static", "animated"].includes(inspectWebpAnimation(bytes) ?? "")
            : ["image/avif", "image/heic", "image/heif"].includes(mimeType) ? await validateIsoImage(bytes, signal) : hasCompleteGif(bytes);
    if (!valid) throw invalid();
    checkCancelled(signal);
    validatedMedia.add(blob);
    return;
  }
  if (!hasCompleteMp4Boxes(bytes)) throw invalid();
  const containsMedia = indexMediaRanges(bytes);
  const input = new Input({formats: [MP4], source: new BufferSource(bytes)});
  let yieldAt = performance.now() + 8;
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw invalid();
    for (const track of await input.getTracks()) {
      const sink = new EncodedPacketSink(track);
      let previousDeclaredPacket: object | undefined;
      let trackBytes = 0;
      // Metadata iteration does not stop silently when a declared sample is outside the file.
      for await (const declared of sink.packets(undefined, undefined, {metadataOnly: true})) {
        // BufferSource promises can all settle in the same task. Yield to a
        // timer so UI cancellation and the caller's deadline can actually run.
        if (performance.now() >= yieldAt) {
          await new Promise<void>(resolve => setTimeout(resolve, 0));
          yieldAt = performance.now() + 8;
        }
        checkCancelled(signal);
        const packet = previousDeclaredPacket ? await sink.getNextPacket(previousDeclaredPacket) : await sink.getFirstPacket();
        // The pinned BufferSource demuxer returns sample subarrays of this input.
        // Check identity as well as bounds; copied/decrypted bytes cannot prove an offset.
        if (!packet || packet.data.byteLength !== declared.byteLength
          || packet.data.buffer !== bytes.buffer
          || !containsMedia(packet.data.byteOffset - bytes.byteOffset, packet.data.byteLength)) throw invalid();
        trackBytes += packet.data.byteLength;
        previousDeclaredPacket = declared;
      }
      if (track === video && !trackBytes) throw invalid();
    }
  } catch (error) {
    checkCancelled(signal);
    throw invalid();
  } finally {
    input.dispose();
  }
  checkCancelled(signal);
  validatedMedia.add(blob);
}

import {BlobSource, EncodedPacketSink, Input, MP4} from "harvest-vendor-mediabunny";
import {hasCompleteGif, hasCompleteMp4Boxes} from "../core/original-media-structure.js";
import {checkCancelled, invalidImage} from "./image-data-contract.js";

/** Inspect structure and declared samples without codec support requirements or re-encoding. */
export async function validateOriginalMedia(blob: Blob, signal?: AbortSignal): Promise<void> {
  if (blob.type !== "image/gif" && blob.type !== "video/mp4") return;
  checkCancelled(signal);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  checkCancelled(signal);
  const invalid = (): Error => invalidImage("メディアのデータが不完全または破損しています。");
  if (blob.type === "image/gif") {
    if (!hasCompleteGif(bytes)) throw invalid();
    return;
  }
  if (!hasCompleteMp4Boxes(bytes)) throw invalid();
  const input = new Input({formats: [MP4], source: new BlobSource(blob)});
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw invalid();
    for (const track of await input.getTracks()) {
      const sink = new EncodedPacketSink(track);
      let previous: object | undefined;
      let videoBytes = 0;
      // Metadata iteration does not stop silently when a declared sample is outside the file.
      for await (const declared of sink.packets(undefined, undefined, {metadataOnly: true})) {
        checkCancelled(signal);
        const packet = previous ? await sink.getNextPacket(previous) : await sink.getFirstPacket();
        if (!packet || packet.data.byteLength !== declared.byteLength) throw invalid();
        videoBytes += packet.data.byteLength;
        previous = declared;
      }
      if (track === video && !videoBytes) throw invalid();
    }
  } catch (error) {
    checkCancelled(signal);
    throw invalid();
  } finally {
    input.dispose();
  }
}

import type {ImageItem} from "../../core/images.js";
import {createMp3CoverTag} from "../../core/mp3-cover.js";
import {checkCancelled, MAX_IMAGE_BYTES} from "../contracts/image-data-contract.js";
import {prepareAudio} from "./audio-conversion.js";
import {fetchImage} from "./image-fetch.js";
import {convertImage} from "./image-format.js";

/** Artwork is optional; cancellation and audio conversion failures still propagate. */
export async function prepareAudioWithCover(
  item: ImageItem, title: string, ...options: Parameters<typeof prepareAudio>
): Promise<Blob> {
  const [, signal, maxBytes = MAX_IMAGE_BYTES] = options;
  const audio = await prepareAudio(...options);
  checkCancelled(signal);
  if (!item.previewUrl) return audio;
  try {
    const fetched = await fetchImage(item.previewUrl, {sourcePage: item.sourcePage, fetchSourcePage: item.fetchSourcePage, ...(signal ? {signal} : {})});
    const image = await convertImage(fetched, "jpg", signal);
    checkCancelled(signal);
    if (image.size > 4 * 1024 * 1024) return audio;
    const tag = createMp3CoverTag(new Uint8Array(await image.arrayBuffer()), "image/jpeg", title);
    checkCancelled(signal);
    if (tag.length + audio.size > Math.min(maxBytes, MAX_IMAGE_BYTES)) return audio;
    return new Blob([tag, audio], {type: "audio/mpeg"});
  } catch {
    checkCancelled(signal);
    return audio;
  }
}

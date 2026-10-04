import type {ImageItem} from "../../core/images.js";
import type {PdfImagePage} from "../../core/pdf-types.js";
import {indexedExportFilename, type SplitExportSettings} from "../../core/split-export-formats.js";
import {storedZipDataLimit} from "../../core/stored-zip.js";
import {ImageArchiveLimitError} from "../../core/image-archive.js";
import {createPreparationWorkers, waitForPreparation} from "../../core/preparation-workers.js";
import type {MutablePendingExport} from "../contracts/export-contracts.js";
import type {FetchedImage} from "../contracts/image-data-contract.js";
import {DEFAULT_MEDIA_TIMEOUT_MS, fetchOriginalMedia} from "./media-fetch.js";
import {fetchImage} from "./image-fetch.js";
import {prepareRecommendedGif} from "./recommended-gif.js";
import {prepareAnimatedImage} from "./animated-image.js";
import {prepareMp4} from "./mp4-conversion.js";
import {convertImage} from "./image-format.js";
import {decodeImage} from "./image-decode.js";

export type PreparedMixedItem = {readonly blob: Blob} | {readonly page: PdfImagePage};
export interface MixedExportWork extends MutablePendingExport<PreparedMixedItem>, SplitExportSettings {
  readonly saved: Set<ImageItem>;
  savingStarted?: boolean;
}
interface Options {
  readonly signal: AbortSignal;
  readonly isStopped: () => boolean;
  readonly onProgress: (completed: number, total: number) => void;
}
type Outcome = {readonly kind: "media"; readonly blob: Blob} | {readonly kind: "image"; readonly fetched: FetchedImage} | {readonly kind: "error"; readonly error: unknown};
function preparedSize(value: PreparedMixedItem): number {
  return "blob" in value ? value.blob.size : "jpeg" in value.page ? value.page.jpeg.byteLength : value.page.rgbFlate.byteLength;
}
/** One bounded fetch window and one conversion, retaining successful source items for retry. */
export async function prepareMixedExport(work: MixedExportWork, options: Options): Promise<void> {
  const remaining = work.selected.filter(item => !work.prepared.has(item));
  const limit = storedZipDataLimit(work.selected.map((_,index) => indexedExportFilename(index,work.selected.length,"webm")));
  let size = [...work.prepared.values()].reduce((total,value) => total + preparedSize(value),0);
  if (size > limit) throw new ImageArchiveLimitError();
  work.failed.clear();
  await Promise.resolve();
  if (options.isStopped()) return;
  const results: Array<{promise: Promise<Outcome & {readonly release: () => void}>; resolve: (result: Outcome & {readonly release: () => void}) => void} | undefined> = remaining.map(() => {
    let resolve!: (result: Outcome & {readonly release: () => void}) => void;
    const promise = new Promise<Outcome & {readonly release: () => void}>(done => {resolve = done;});
    return {promise,resolve};
  });
  const concurrency = remaining.some(item => item.kind === "video" || item.kind === "gif" || item.recommendedFormat === "gif" || work.imageFormat === "original") ? 1 : 3;
  const workers = createPreparationWorkers(remaining.length,concurrency,options.signal,async (index,signal,release) => {
    const item = remaining[index]!;
    try {
      const original = item.kind === "video" || work.imageFormat === "original";
      if (original) results[index]!.resolve({kind:"media",blob:await fetchOriginalMedia(item.url,item.kind ?? "image",{signal,sourcePage:item.sourcePage}),release});
      else {
        const knownGif = item.kind === "gif" || item.recommendedFormat === "gif";
        results[index]!.resolve({kind:"image",fetched:await fetchImage(item.url,{signal,sourcePage:item.sourcePage,...(knownGif ? {timeoutMs:DEFAULT_MEDIA_TIMEOUT_MS} : {})}),release});
      }
    } catch (error) { results[index]!.resolve({kind:"error",error,release}); }
  });
  const completion = Promise.allSettled([workers.finished]);
  try {
    for (let index = 0; index < remaining.length; index++) {
      if (options.isStopped()) return;
      const outcome = await waitForPreparation(results[index]!.promise,workers.signal), item = remaining[index]!;
      try {
        if (options.isStopped()) return;
        if (outcome.kind === "error") throw outcome.error;
        let prepared: PreparedMixedItem;
        if (item.kind === "video") {
          if (outcome.kind !== "media") throw new Error("選択項目と保存データの形式が一致しません。");
          const input = outcome.blob;
          prepared = {blob:work.videoFormat === "original" ? input : await prepareMp4(input,options.signal,limit-size)};
        } else if (work.imageFormat === "original") {
          if (outcome.kind !== "media") throw new Error("選択項目と保存データの形式が一致しません。");
          prepared = {blob:outcome.blob};
        }
        else {
          if (outcome.kind !== "image") throw new Error("選択項目と保存データの形式が一致しません。");
          const fetched = outcome.fetched;
          const originalGif = await prepareRecommendedGif(fetched,options.signal);
          if (item.kind === "gif" && !originalGif) throw new Error("メディアの種類とデータが一致しません。");
          const animation = originalGif ?? await prepareAnimatedImage(fetched,options.signal,limit-size);
          item.recommendedFormat = animation ? "gif" : "png";
          prepared = animation ? {blob:animation}
            : work.imageFormat === "pdf" ? {page:await decodeImage(fetched,{signal:options.signal})}
            : {blob:await convertImage(fetched,work.imageFormat === "recommend" ? "png" : work.imageFormat,options.signal)};
        }
        if (options.isStopped()) return;
        const bytes = preparedSize(prepared);
        if (bytes > limit-size) throw new ImageArchiveLimitError();
        work.prepared.set(item,prepared);size += bytes;
      } catch (error) {
        if (options.isStopped()) return;
        if (error instanceof ImageArchiveLimitError) throw error;
        work.failed.set(item,error instanceof Error ? error.message : "保存するデータを準備できませんでした。");
      } finally {results[index]=undefined;outcome.release();}
      options.onProgress(index+1,remaining.length);
    }
  } finally {workers.abort();await completion;}
}

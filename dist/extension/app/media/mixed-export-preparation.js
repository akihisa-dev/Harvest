import { individualFilename } from "../../core/export-files.js";
import { originalMediaType } from "../../core/media-types.js";
import { indexedExportFilename } from "../../core/split-export-formats.js";
import { storedZipDataLimit, storedZipEntryLimit } from "../../core/stored-zip.js";
import { ImageArchiveLimitError } from "../../core/image-archive.js";
import { createPreparationWorkers, waitForPreparation } from "../../core/preparation-workers.js";
import { DEFAULT_MEDIA_TIMEOUT_MS, fetchOriginalMedia } from "./media-fetch.js";
import { fetchImage } from "./image-fetch.js";
import { prepareRecommendedGif } from "./recommended-gif.js";
import { prepareAnimatedImage } from "./animated-image.js";
import { prepareAudioWithCover } from "./audio-cover.js";
import { prepareMp4 } from "./mp4-conversion.js";
import { convertImage } from "./image-format.js";
import { decodeImage } from "./image-decode.js";
import { fetchYoutubeVideo } from "./youtube-fetch.js";
function preparedSize(value) {
    return "blob" in value ? value.blob.size : "jpeg" in value.page ? value.page.jpeg.byteLength : value.page.rgbFlate.byteLength;
}
/** One bounded fetch window and one conversion, retaining successful source items for retry. */
export async function prepareMixedExport(work, options) {
    const imageFormat = work.resolvedImageFormat;
    const remaining = work.selected.filter(item => !work.prepared.has(item));
    if (work.selected.length > storedZipEntryLimit)
        throw new ImageArchiveLimitError();
    const limit = storedZipDataLimit(work.selected.map((_, index) => indexedExportFilename(index, work.selected.length, "webm")));
    let size = [...work.prepared.values()].reduce((total, value) => total + preparedSize(value), 0);
    if (size > limit)
        throw new ImageArchiveLimitError();
    work.failed.clear();
    await Promise.resolve();
    if (options.isStopped())
        return;
    const results = remaining.map(() => {
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        return { promise, resolve };
    });
    // Original still images use the same bounded window as converted images.
    // Keep known video/animation work serial to bound its larger working sets.
    const concurrency = remaining.some(item => item.kind === "video" || item.kind === "gif" || item.recommendedFormat === "gif") ? 1 : 3;
    const fractions = remaining.map(() => 0);
    let completedUnits = 0;
    const itemProgress = (index, fraction) => {
        if (options.isStopped() || !Number.isFinite(fraction))
            return;
        const next = Math.max(fractions[index], Math.min(.99, Math.max(0, fraction)));
        completedUnits += next - fractions[index];
        fractions[index] = next;
        options.onProgress(completedUnits, remaining.length);
    };
    const workers = createPreparationWorkers(remaining.length, concurrency, options.signal, async (index, signal, release) => {
        const item = remaining[index];
        try {
            const original = item.kind === "video" || imageFormat === "original";
            if (original) {
                const onProgress = item.kind === "video" ? (fraction) => itemProgress(index, fraction * (work.videoFormat === "original" ? .95 : .7)) : undefined;
                results[index].resolve({ kind: "media", blob: item.youtube ? await fetchYoutubeVideo(item.youtube, signal, onProgress) : await fetchOriginalMedia(item.url, item.kind ?? "image", { signal, sourcePage: item.sourcePage, fetchSourcePage: item.fetchSourcePage, ...(item.stream ? { stream: item.stream } : {}), ...(onProgress ? { onProgress } : {}) }), release });
            }
            else {
                const knownGif = item.kind === "gif" || item.recommendedFormat === "gif";
                results[index].resolve({ kind: "image", fetched: await fetchImage(item.url, { signal, sourcePage: item.sourcePage, fetchSourcePage: item.fetchSourcePage, ...(knownGif ? { timeoutMs: DEFAULT_MEDIA_TIMEOUT_MS } : {}) }), release });
            }
        }
        catch (error) {
            results[index].resolve({ kind: "error", error, release });
        }
    });
    const completion = Promise.allSettled([workers.finished]);
    try {
        for (let index = 0; index < remaining.length; index++) {
            if (options.isStopped())
                return;
            const outcome = await waitForPreparation(results[index].promise, workers.signal), item = remaining[index];
            try {
                if (options.isStopped())
                    return;
                if (outcome.kind === "error")
                    throw outcome.error;
                if (outcome.kind === "media") {
                    const type = originalMediaType(outcome.blob.type);
                    if (type) {
                        item.originalExtension = type.extension;
                        if (type.kind === "gif")
                            item.recommendedFormat = "gif";
                    }
                }
                let prepared;
                if (item.kind === "video") {
                    if (outcome.kind !== "media")
                        throw new Error("選択項目と保存データの形式が一致しません。");
                    const input = outcome.blob;
                    const onProgress = (fraction) => itemProgress(index, .7 + .29 * fraction);
                    const title = individualFilename(work.audioFilename ?? "Harvest.zip", indexedExportFilename(work.selected.indexOf(item), work.selected.length, "mp3"), work.selected.length).replace(/\.mp3$/i, "");
                    prepared = { blob: work.videoFormat === "original" ? input : work.videoFormat === "mp3" ? await prepareAudioWithCover(item, title, input, options.signal, limit - size, onProgress) : await prepareMp4(input, options.signal, limit - size, onProgress) };
                }
                else if (imageFormat === "original") {
                    if (outcome.kind !== "media")
                        throw new Error("選択項目と保存データの形式が一致しません。");
                    prepared = { blob: outcome.blob };
                }
                else {
                    if (outcome.kind !== "image")
                        throw new Error("選択項目と保存データの形式が一致しません。");
                    const fetched = outcome.fetched;
                    const originalGif = await prepareRecommendedGif(fetched, options.signal);
                    if (item.kind === "gif" && !originalGif)
                        throw new Error("メディアの種類とデータが一致しません。");
                    const animation = originalGif ?? await prepareAnimatedImage(fetched, options.signal, limit - size);
                    item.recommendedFormat = animation ? "gif" : "png";
                    prepared = animation ? { blob: animation }
                        : imageFormat === "pdf" ? { page: await decodeImage(fetched, { signal: options.signal }) }
                            : { blob: await convertImage(fetched, imageFormat, options.signal) };
                    const originalExtension = fetched.kind === "original" ? "jpg" : originalMediaType(fetched.blob.type)?.extension;
                    if (originalExtension)
                        item.originalExtension = originalExtension;
                }
                if (options.isStopped())
                    return;
                const bytes = preparedSize(prepared);
                if (bytes > limit - size)
                    throw new ImageArchiveLimitError();
                work.prepared.set(item, prepared);
                size += bytes;
            }
            catch (error) {
                if (options.isStopped())
                    return;
                if (error instanceof ImageArchiveLimitError)
                    throw error;
                work.failed.set(item, error instanceof Error ? error.message : "保存するデータを準備できませんでした。");
            }
            finally {
                results[index] = undefined;
                outcome.release();
            }
            completedUnits += 1 - fractions[index];
            fractions[index] = 1;
            options.onProgress(completedUnits, remaining.length);
        }
    }
    finally {
        workers.abort();
        await completion;
    }
}

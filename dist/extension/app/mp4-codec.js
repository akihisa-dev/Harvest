import { BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, QUALITY_HIGH, WEBM } from "./vendor/mediabunny/index.js";
/** Converts a validated WebM response locally; an unsupported track must never disappear silently. */
export async function convertWebmToMp4(blob, maxBytes) {
    const input = new Input({ formats: [WEBM], source: new BlobSource(blob) });
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    let conversion;
    target.on("write", ({ end }) => {
        if (end > maxBytes)
            throw new Error("MP4変換後の動画が保存容量の上限を超えています。");
    });
    try {
        if (!await input.getPrimaryVideoTrack())
            throw new Error("動画に映像がありません。");
        conversion = await Conversion.init({
            input, output,
            video: { codec: "avc", bitrate: QUALITY_HIGH },
            audio: { codec: "aac", bitrate: QUALITY_HIGH },
            showWarnings: false,
        });
        if (!conversion.isValid || conversion.discardedTracks.length) {
            throw new Error("この環境では動画の映像または音声をMP4へ変換できません。");
        }
        await conversion.execute();
        if (!target.buffer?.byteLength)
            throw new Error("MP4への変換結果が空です。");
        if (target.buffer.byteLength > maxBytes)
            throw new Error("MP4変換後の動画が保存容量の上限を超えています。");
        return new Blob([target.buffer], { type: "video/mp4" });
    }
    finally {
        await conversion?.cancel().catch(() => { });
        await output.cancel().catch(() => { });
        input.dispose();
    }
}

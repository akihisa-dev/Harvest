import { AudioSampleSink, BlobSource, Input, MP4, WEBM } from "../vendor/mediabunny/index.js";
import { Mp3Encoder } from "../../core/mp3-encoder.js";
/** Decode with the existing video reader; MP3 compression and framing are our own core code. */
export async function extractAudio(blob, maxBytes, onProgress) {
    const input = new Input({ formats: [MP4, WEBM], source: new BlobSource(blob) });
    try {
        const track = await input.getPrimaryAudioTrack();
        if (!track)
            throw new Error("この動画には音声がありません。");
        const duration = onProgress ? await track.computeDuration() : 0;
        let encoder, firstTimestamp = 0, position = 0;
        for await (const sample of new AudioSampleSink(track).samples()) {
            try {
                encoder ??= new Mp3Encoder(sample.sampleRate, sample.numberOfChannels, maxBytes);
                if (sample.sampleRate !== encoder.sampleRate || sample.numberOfChannels !== encoder.channels
                    || !Number.isFinite(sample.timestamp))
                    throw new Error("この環境では動画から音声を取り出せません。");
                if (!position)
                    firstTimestamp = sample.timestamp;
                const start = Math.round((sample.timestamp - firstTimestamp) * encoder.sampleRate);
                if (!Number.isSafeInteger(start) || !Number.isSafeInteger(sample.numberOfFrames) || sample.numberOfFrames < 1) {
                    throw new Error("この環境では動画から音声を取り出せません。");
                }
                // Preserve timestamp gaps using bounded silence, without retaining decoded audio.
                let gap = start - position;
                while (gap > 0) {
                    const length = Math.min(gap, 1152);
                    encoder.add(Array.from({ length: encoder.channels }, () => new Float32Array(length)));
                    gap -= length;
                    position += length;
                }
                const planes = Array.from({ length: encoder.channels }, (_, channel) => {
                    const plane = new Float32Array(sample.numberOfFrames);
                    sample.copyTo(plane, { planeIndex: channel, format: "f32-planar" });
                    return plane.subarray(Math.min(sample.numberOfFrames, Math.max(0, position - start)));
                });
                encoder.add(planes);
                position += planes[0].length;
                if (duration > 0)
                    onProgress?.(Math.min(1, (sample.timestamp + sample.numberOfFrames / sample.sampleRate) / duration));
            }
            finally {
                sample.close();
            }
        }
        if (!encoder)
            throw new Error("音声を取り出した結果が空です。");
        return encoder.finish();
    }
    finally {
        input.dispose();
    }
}

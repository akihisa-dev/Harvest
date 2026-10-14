import { youtubeStreamingUrl } from "./youtube.js";
import { encodeBytes, encodeNumber, encodeText, joinBytes, readUmp, readWire, replaceWire, wireBytes, wireNumber, wireText } from "./youtube-wire.js";
const invalid = () => new Error("YouTube動画の分割データが不完全または未対応です。");
// SABR's enum uses 0 for both tracks; it is not an audio/video bitwise OR.
const VIDEO_AND_AUDIO = 0;
export const youtubeAuthenticationError = "YouTubeの取得用認証を更新できませんでした。もう一度保存をお試しください。";
function formatId(format) {
    return joinBytes([encodeNumber(1, format.itag), encodeNumber(2, BigInt(format.lastModified)), encodeText(3, format.xtags)]);
}
function sameFormat(data, format) {
    const fields = readWire(data), modified = fields.find(f => f.id === 2);
    return wireNumber(fields, 1) === format.itag && modified?.wire === 0 && String(modified.value) === format.lastModified
        && wireText(fields, 3) === format.xtags;
}
function packed(fields, id) {
    const result = [];
    for (const field of fields.filter(f => f.id === id)) {
        if (field.wire === 0)
            result.push(Number(field.value));
        else if (field.wire === 2) {
            const bytes = field.value;
            let offset = 0;
            while (offset < bytes.length) {
                let value = 0, multiplier = 1, finished = false;
                for (let count = 0; count < 5 && offset < bytes.length; count++) {
                    const byte = bytes[offset++];
                    value += (byte & 127) * multiplier;
                    multiplier *= 128;
                    if (byte < 128) {
                        finished = true;
                        break;
                    }
                }
                if (!finished)
                    throw invalid();
                result.push(value);
            }
        }
        else
            throw invalid();
    }
    if (result.length > 128 || result.some(v => !Number.isSafeInteger(v) || v < 0))
        throw invalid();
    return result;
}
/** A fail-closed VOD downloader state. Network, tokens, and media never persist outside its owner. */
export class YoutubeSabrSession {
    videoId;
    template;
    maxBytes;
    tracks;
    partials = new Map();
    contexts = new Map();
    initialContexts = new Map();
    activeContexts = new Set();
    unsentContexts = new Set();
    cookie;
    total = 0;
    partialBytes = 0;
    endpoint;
    waitMs = 0;
    abr;
    context;
    constructor(videoId, url, template, video, audio, maxBytes) {
        this.videoId = videoId;
        this.template = template;
        this.maxBytes = maxBytes;
        this.endpoint = youtubeStreamingUrl(url);
        const request = readWire(template);
        this.abr = wireBytes(request, 1) ?? new Uint8Array();
        this.context = wireBytes(request, 19) ?? new Uint8Array();
        const context = readWire(this.context), token = wireBytes(context, 2);
        if (!wireBytes(request, 5)?.length || !token || token.length < 16 || !wireBytes(context, 1))
            throw new Error(youtubeAuthenticationError);
        this.cookie = wireBytes(context, 3)?.slice();
        for (const field of context.filter(f => f.id === 5)) {
            if (field.wire !== 2 || this.contexts.size >= 128)
                throw invalid();
            const raw = field.value, fields = readWire(raw), id = wireNumber(fields, 1), value = wireBytes(fields, 2);
            if (!value || this.contexts.has(id))
                throw invalid();
            this.contexts.set(id, value.slice());
            this.initialContexts.set(id, raw.slice());
            this.activeContexts.add(id);
        }
        for (const id of packed(context, 6)) {
            if (!this.activeContexts.has(id))
                this.unsentContexts.add(id);
        }
        this.tracks = [{ format: video, segments: new Map() }, { format: audio, segments: new Map() }];
        if (video.contentLength + audio.contentLength > maxBytes)
            throw new Error("YouTube動画が保存容量の上限を超えています。");
    }
    get url() { return this.endpoint; }
    get backoffMs() { return this.waitMs; }
    get downloadedBytes() { return this.total; }
    /** Count valid in-progress fragments too; an HTTP response need not finish a segment. */
    get receivedBytes() { return this.total + this.partialBytes; }
    covered(track) {
        let end = 0, sequence = 1;
        while (track.segments.has(sequence)) {
            const segment = track.segments.get(sequence++);
            if (Math.abs(segment.start - end) > 2)
                throw invalid();
            end = segment.start + segment.duration;
        }
        return end;
    }
    get progressMs() { return Math.min(...this.tracks.map(t => this.covered(t))); }
    get complete() {
        return this.partials.size === 0 && this.tracks.every(t => t.init && t.lastSegment !== undefined && t.lastSegment > 0
            && t.segments.size === t.lastSegment && t.endMs !== undefined && Math.abs(this.covered(t) - t.endMs) <= 100);
    }
    request(elapsedMs) {
        const progress = this.progressMs;
        const changes = new Map([
            [21, [encodeNumber(21, this.tracks[0].format.height)]], [28, [encodeNumber(28, Math.round(progress))]],
            [29, [encodeNumber(29, elapsedMs)]], [36, [encodeNumber(36, elapsedMs)]], [39, [encodeNumber(39, elapsedMs)]], [40, [encodeNumber(40, VIDEO_AND_AUDIO)]],
        ]);
        const contextChanges = new Map([
            [3, this.cookie ? [encodeBytes(3, this.cookie)] : []],
            [5, [...this.contexts].filter(([id]) => this.activeContexts.has(id)).map(([id, data]) => encodeBytes(5, this.initialContexts.get(id) ?? joinBytes([encodeNumber(1, id), encodeBytes(2, data)])))],
            [6, [...new Set([...this.unsentContexts, ...[...this.contexts.keys()].filter(id => !this.activeContexts.has(id))])].filter(id => !this.activeContexts.has(id)).map(id => encodeNumber(6, id))],
        ]);
        const ranges = this.tracks.filter(t => t.init && this.contiguousCount(t) > 0).map(t => encodeBytes(3, joinBytes([
            encodeBytes(1, formatId(t.format)), encodeNumber(2, 0), encodeNumber(3, Math.round(this.covered(t))),
            encodeNumber(4, 1), encodeNumber(5, this.contiguousCount(t)),
        ])));
        return replaceWire(this.template, new Map([
            [1, [encodeBytes(1, replaceWire(this.abr, changes))]],
            [2, this.tracks.filter(t => t.init).map(t => encodeBytes(2, formatId(t.format)))],
            [3, ranges], [4, []], [6, []],
            [16, [encodeBytes(16, formatId(this.tracks[1].format))]], [17, [encodeBytes(17, formatId(this.tracks[0].format))]],
            [18, []], [19, [encodeBytes(19, replaceWire(this.context, contextChanges))]], [21, []], [24, []], [25, []], [1000, []],
        ]));
    }
    contiguousCount(track) { let count = 0; while (track.segments.has(count + 1))
        count++; return count; }
    ingest(bytes) {
        for (const part of readUmp(bytes, this.maxBytes)) {
            if (part.type === 21) {
                this.media(part.data);
                continue;
            }
            if (part.type === 22) {
                this.end(part.data);
                continue;
            }
            // Metadata is bounded separately from media; unknown non-media parts cannot create output.
            if (part.data.length > 65536)
                throw invalid();
            const fields = readWire(part.data);
            if (part.type === 20)
                this.header(fields);
            else if (part.type === 42)
                this.initialize(fields);
            else if (part.type === 35) {
                const id = wireText(fields, 8);
                if (id && id !== this.videoId)
                    throw invalid();
                const cookie = wireBytes(fields, 7);
                if (cookie)
                    this.cookie = cookie.slice();
                this.waitMs = wireNumber(fields, 4);
                if (this.waitMs > 30000)
                    throw new Error("YouTubeの動画配信が待機状態になりました。もう一度保存してください。");
            }
            else if (part.type === 43)
                this.endpoint = youtubeStreamingUrl(wireText(fields, 1));
            else if (part.type === 44 || part.type === 45)
                throw new Error("YouTubeの動画配信が取得を継続できませんでした。");
            else if (part.type === 46)
                throw new Error(youtubeAuthenticationError);
            else if (part.type === 58) {
                if (wireNumber(fields, 1) >= 3)
                    throw new Error(youtubeAuthenticationError);
            }
            else if (part.type === 57) {
                const id = wireNumber(fields, 1), data = wireBytes(fields, 3), policy = wireNumber(fields, 5);
                if (data) {
                    if (this.contexts.size >= 128 && !this.contexts.has(id))
                        throw invalid();
                    if (policy !== 2 || !this.contexts.has(id)) {
                        this.contexts.set(id, data.slice());
                        this.initialContexts.delete(id);
                    }
                }
                if (wireNumber(fields, 4)) {
                    this.activeContexts.add(id);
                    this.unsentContexts.delete(id);
                }
            }
            else if (part.type === 59) {
                for (const id of packed(fields, 1)) {
                    this.activeContexts.add(id);
                    this.unsentContexts.delete(id);
                }
                for (const id of packed(fields, 2))
                    this.activeContexts.delete(id);
                for (const id of packed(fields, 3)) {
                    this.activeContexts.delete(id);
                    this.contexts.delete(id);
                    this.initialContexts.delete(id);
                    this.unsentContexts.delete(id);
                }
            }
        }
    }
    initialize(fields) {
        if (wireText(fields, 1) !== this.videoId)
            throw invalid();
        const id = wireBytes(fields, 2);
        if (!id)
            throw invalid();
        const track = this.tracks.find(t => sameFormat(id, t.format));
        if (!track)
            return;
        const last = wireNumber(fields, 4), timescale = wireNumber(fields, 10), ticks = wireNumber(fields, 9);
        const end = timescale && ticks ? ticks * 1000 / timescale : wireNumber(fields, 3);
        if (last <= 0 || last > 50000 || !Number.isFinite(end) || end <= 0 || Math.abs(end - track.format.durationMs) > 1500)
            throw invalid();
        if (track.lastSegment !== undefined && (track.lastSegment !== last || track.endMs !== end))
            throw invalid();
        track.lastSegment = last;
        track.endMs = end;
    }
    header(fields) {
        if (wireText(fields, 2) !== this.videoId || wireNumber(fields, 7) !== 0)
            throw invalid();
        const id = wireNumber(fields, 1);
        if (id > 255 || this.partials.has(id))
            throw invalid();
        const format = wireBytes(fields, 13) ?? joinBytes([encodeNumber(1, wireNumber(fields, 3)), encodeNumber(2, wireNumber(fields, 4)), encodeText(3, wireText(fields, 5))]);
        const track = this.tracks.find(t => sameFormat(format, t.format));
        if (!track)
            throw new Error("YouTubeが指定した画質とは異なる動画を返しました。");
        const init = Boolean(wireNumber(fields, 8)), sequence = wireNumber(fields, 9), expected = wireNumber(fields, 14);
        let start = wireNumber(fields, 11), duration = wireNumber(fields, 12);
        const time = wireBytes(fields, 15);
        if (time) {
            const range = readWire(time), scale = wireNumber(range, 3);
            if (scale) {
                start = wireNumber(range, 1) * 1000 / scale;
                duration = wireNumber(range, 2) * 1000 / scale;
            }
        }
        if (expected <= 0 || expected > this.maxBytes || sequence > 50000 || (!init && (sequence < 1 || duration <= 0)) || (init && sequence !== 0))
            throw invalid();
        this.partials.set(id, { track, init, sequence, start, duration, expected, chunks: [], bytes: 0 });
    }
    media(data) {
        const partial = this.partials.get(data[0] ?? -1);
        if (!partial || data.length < 2)
            throw invalid();
        const chunk = data.subarray(1);
        if (chunk.length > partial.expected - partial.bytes || chunk.length > this.maxBytes - this.partialBytes)
            throw invalid();
        partial.chunks.push(chunk.slice());
        partial.bytes += chunk.length;
        this.partialBytes += chunk.length;
    }
    end(data) {
        if (data.length !== 1)
            throw invalid();
        const partial = this.partials.get(data[0]);
        if (!partial || partial.bytes !== partial.expected)
            throw invalid();
        const bytes = joinBytes(partial.chunks), old = partial.init ? partial.track.init : partial.track.segments.get(partial.sequence)?.data;
        const previous = partial.init ? undefined : partial.track.segments.get(partial.sequence);
        if (previous && (previous.start !== partial.start || previous.duration !== partial.duration))
            throw invalid();
        if (old) {
            if (old.length !== bytes.length || old.some((value, index) => value !== bytes[index]))
                throw invalid();
        }
        else {
            if (bytes.length > this.maxBytes - this.total)
                throw new Error("YouTube動画が保存容量の上限を超えています。");
            this.total += bytes.length;
            if (partial.init)
                partial.track.init = bytes;
            else
                partial.track.segments.set(partial.sequence, { sequence: partial.sequence, start: partial.start, duration: partial.duration, data: bytes });
        }
        this.partialBytes -= partial.bytes;
        this.partials.delete(data[0]);
    }
    output() {
        if (!this.complete)
            throw invalid();
        const result = this.tracks.map(t => joinBytes([t.init, ...[...t.segments.values()].sort((a, b) => a.sequence - b.sequence).map(s => s.data)]));
        return { video: result[0], audio: result[1], durations: { videoMs: this.tracks[0].endMs, audioMs: this.tracks[1].endMs } };
    }
}

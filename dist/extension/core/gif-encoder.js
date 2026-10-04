import { gifPalette } from "./gif-palette.js";
import { gifLzw } from "./gif-lzw.js";
/** Complete composited frames, adaptive per-frame palettes, and cumulative timing. */
export class GifEncoder {
    width;
    height;
    maxBytes;
    transparentCanvas;
    parts = [];
    bytes = 0;
    elapsed = 0;
    ticks = 0;
    frames = 0;
    constructor(width, height, repetitions, maxBytes, transparentCanvas = false) {
        this.width = width;
        this.height = height;
        this.maxBytes = maxBytes;
        this.transparentCanvas = transparentCanvas;
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 65535 || height > 65535)
            throw new Error("GIFの大きさを保持できません。");
        this.append(Uint8Array.from([71, 73, 70, 56, 57, 97, width & 255, width >> 8, height & 255, height >> 8, 0xf0, 0, 0]));
        this.append(Uint8Array.from([0, 0, 0, 255, 255, 255]));
        if (repetitions === Infinity || repetitions > 0) {
            const loop = repetitions === Infinity ? 0 : repetitions;
            if (!Number.isInteger(loop) || loop < 0 || loop > 65535)
                throw new Error("GIFのループ回数を保持できません。");
            this.append(Uint8Array.from([33, 255, 11, ...new TextEncoder().encode("NETSCAPE2.0"), 3, 1, loop & 255, loop >> 8, 0]));
        }
    }
    append(part) {
        if (part.length > this.maxBytes - this.bytes)
            throw new Error("GIF変換後の画像が保存容量の上限を超えています。");
        this.bytes += part.length;
        this.parts.push(part);
    }
    add(rgba, durationMicroseconds) {
        if (rgba.length !== this.width * this.height * 4)
            throw new Error("GIFのフレームの大きさが一致しません。");
        if (!Number.isFinite(durationMicroseconds) || durationMicroseconds < 10000)
            throw new Error("GIFの10ms刻みではフレームの表示時間を保持できません。originalを選んで保存してください。");
        // Browser GIF players commonly clamp 10ms to 100ms. Apply the floor
        // before cumulative rounding so later frames never repay shorter frames.
        this.elapsed += Math.max(20000, durationMicroseconds);
        const end = Math.round(this.elapsed / 10000), delay = end - this.ticks;
        if (delay < 2 || delay > 65535)
            throw new Error("GIFのフレームの表示時間を保持できません。originalを選んで保存してください。");
        this.ticks = end;
        const { palette, indices, transparent } = gifPalette(rgba, this.transparentCanvas);
        // Every frame uses transparency when any frame needs it, so disposal 2
        // clears to transparency across opaque/transparent changes and loop boundaries.
        this.append(Uint8Array.from([33, 249, 4, transparent ? 9 : 8, delay & 255, delay >> 8, 0, 0, 44, 0, 0, 0, 0, this.width & 255, this.width >> 8, this.height & 255, this.height >> 8, 0x87]));
        this.append(palette);
        this.append(Uint8Array.of(8));
        const data = gifLzw(indices, this.maxBytes - this.bytes);
        const blocks = new Uint8Array(data.length + Math.ceil(data.length / 255) + 1);
        let offset = 0;
        for (let start = 0; start < data.length; start += 255) {
            const block = data.subarray(start, Math.min(data.length, start + 255));
            blocks[offset++] = block.length;
            blocks.set(block, offset);
            offset += block.length;
        }
        this.append(blocks);
        this.frames++;
    }
    finish() {
        if (!this.frames)
            throw new Error("GIFへの変換結果が空です。");
        this.append(Uint8Array.of(59));
        return new Blob(this.parts, { type: "image/gif" });
    }
}

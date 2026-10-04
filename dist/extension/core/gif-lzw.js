/** GIF LZW with a bounded 12-bit dictionary, clear codes, and least-significant-bit packing. */
export function gifLzw(indices, maxBytes) {
    let output = new Uint8Array(Math.min(4096, maxBytes)), length = 0, bits = 0, value = 0;
    let width = 9, next = 258;
    const dictionary = new Map();
    const byte = (n) => {
        if (length >= maxBytes)
            throw new Error("GIF変換後の画像が保存容量の上限を超えています。");
        if (length === output.length) {
            const grown = new Uint8Array(Math.min(maxBytes, Math.max(1, output.length * 2)));
            grown.set(output);
            output = grown;
        }
        output[length++] = n;
    };
    const code = (n) => {
        value |= n << bits;
        bits += width;
        while (bits >= 8) {
            byte(value & 255);
            value >>>= 8;
            bits -= 8;
        }
        // The decoder's dictionary lags this encoder by one entry.
        if (next === 1 << width && width < 12)
            width++;
    };
    code(256);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
        const color = indices[i], key = (prefix << 8) | color, found = dictionary.get(key);
        if (found !== undefined) {
            prefix = found;
            continue;
        }
        code(prefix);
        if (next < 4096)
            dictionary.set(key, next++);
        else {
            code(256);
            dictionary.clear();
            next = 258;
            width = 9;
        }
        prefix = color;
    }
    code(prefix);
    code(257);
    if (bits)
        byte(value & 255);
    return output.slice(0, length);
}

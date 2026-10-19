/** ID3v2.3 front cover (APIC), with tag-wide unsynchronisation. */
export function createMp3CoverTag(image, mime) {
    if (!image.length || image.length > 4 * 1024 * 1024)
        throw new RangeError("MP3 cover exceeds the image limit.");
    // Latin-1 encoding, terminated MIME, front cover (3), empty description.
    const prefix = new TextEncoder().encode(`\0${mime}\0\x03\0`);
    const frame = new Uint8Array(10 + prefix.length + image.length);
    frame.set([0x41, 0x50, 0x49, 0x43]);
    new DataView(frame.buffer).setUint32(4, prefix.length + image.length);
    frame.set(prefix, 10);
    frame.set(image, 10 + prefix.length);
    let extra = 0;
    const escapeAt = (i) => frame[i] === 0xff && (i + 1 === frame.length || frame[i + 1] === 0 || frame[i + 1] >= 0xe0);
    for (let i = 0; i < frame.length; i++)
        if (escapeAt(i))
            extra++;
    const size = frame.length + extra;
    const tag = new Uint8Array(10 + size);
    tag.set([0x49, 0x44, 0x33, 3, 0, extra ? 0x80 : 0,
        (size >>> 21) & 0x7f, (size >>> 14) & 0x7f, (size >>> 7) & 0x7f, size & 0x7f]);
    for (let i = 0, at = 10; i < frame.length; i++) {
        tag[at++] = frame[i];
        if (escapeAt(i))
            tag[at++] = 0;
    }
    return tag;
}

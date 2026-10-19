/** ID3v2.3 title followed by a front-cover APIC frame, as verified in Music. */
export function createMp3CoverTag(image: Uint8Array, mime: "image/jpeg" | "image/png", title: string): Uint8Array<ArrayBuffer> {
  if (!image.length || image.length > 4 * 1024 * 1024) throw new RangeError("MP3 cover exceeds the image limit.");
  const label = title.replace(/\0/g, "").trim().slice(0, 1024) || "Harvest";
  // ID3v2.3 supports Latin-1 and UTF-16 with BOM; preserve Japanese titles.
  let text: Uint8Array<ArrayBuffer>;
  if (/^[\x20-\x7e]+$/.test(label)) {
    text = new Uint8Array(1 + label.length);
    text.set(new TextEncoder().encode(label), 1);
  } else {
    text = new Uint8Array(3 + label.length * 2);
    text.set([1, 0xff, 0xfe]);
    const view = new DataView(text.buffer);
    for (let i = 0; i < label.length; i++) view.setUint16(3 + i * 2, label.charCodeAt(i), true);
  }
  // Latin-1 encoding, terminated MIME, front cover (3), empty description.
  const prefix = new TextEncoder().encode(`\0${mime}\0\x03\0`);
  const size = 10 + text.length + 10 + prefix.length + image.length;
  const tag = new Uint8Array(10 + size), view = new DataView(tag.buffer);
  tag.set([0x49, 0x44, 0x33, 3, 0, 0,
    (size >>> 21) & 0x7f, (size >>> 14) & 0x7f, (size >>> 7) & 0x7f, size & 0x7f]);
  tag.set([0x54, 0x49, 0x54, 0x32], 10); // TIT2
  view.setUint32(14, text.length);
  tag.set(text, 20);
  const at = 20 + text.length;
  tag.set([0x41, 0x50, 0x49, 0x43], at); // APIC
  view.setUint32(at + 4, prefix.length + image.length);
  tag.set(prefix, at + 10);
  tag.set(image, at + 10 + prefix.length);
  return tag;
}

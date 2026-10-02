// Locally generated 3 × 2 RGB fixtures, encoded with Pillow; no external image content.
const baselineBase64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAMDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDiKKKK9g8s/9k=";
const progressiveBase64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wgARCAACAAMDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUAQEAAAAAAAAAAAAAAAAAAAAE/9oADAMBAAIQAxAAAAGGGF//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAn//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AX//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AX//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/An//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEPP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==";

export const baselineJpeg = new Uint8Array(Buffer.from(baselineBase64, "base64"));
export const progressiveJpeg = new Uint8Array(Buffer.from(progressiveBase64, "base64"));
export const exifJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 8, 0x45, 0x78, 0x69, 0x66, 0, 0, ...baselineJpeg.slice(2)]);

function withoutSegments(bytes, removed) {
  const result = [...bytes.slice(0, 2)];
  let offset = 2;
  while (bytes[offset + 1] !== 0xda) {
    const end = offset + 2 + bytes[offset + 2] * 256 + bytes[offset + 3];
    if (!removed.includes(bytes[offset + 1])) result.push(...bytes.slice(offset, end));
    offset = end;
  }
  return new Uint8Array([...result, ...bytes.slice(offset)]);
}

const sos = baselineJpeg.findIndex((byte, index) => byte === 0xff && baselineJpeg[index + 1] === 0xda);
const sof = baselineJpeg.findIndex((byte, index) => byte === 0xff && baselineJpeg[index + 1] === 0xc0);
const scanStart = sos + 2 + baselineJpeg[sos + 2] * 256 + baselineJpeg[sos + 3];
const incompleteComponents = baselineJpeg.slice();
incompleteComponents[sof + 3] = 8;

export const brokenJpegs = {
  "issue-25-bytes": new Uint8Array([255, 216, 255, 224, 0, 7, 74, 70, 73, 70, 0, 255, 192, 0, 8, 8, 0, 1, 0, 1, 3, 255, 218, 255, 217]),
  "missing-scan-header": new Uint8Array([...baselineJpeg.slice(0, sos + 2), 255, 217]),
  "missing-components": incompleteComponents,
  "missing-quantization": withoutSegments(baselineJpeg, [0xdb]),
  "missing-huffman": withoutSegments(baselineJpeg, [0xc4]),
  "missing-scan-data": new Uint8Array([...baselineJpeg.slice(0, scanStart), 255, 217]),
  "truncated-scan": baselineJpeg.slice(0, scanStart + 1),
  "missing-end": baselineJpeg.slice(0, -2),
};

// This retains complete segments but defines an impossible Huffman code tree.
// It must reach and fail the browser decoder, rather than only the structure check.
export const undecodableJpeg = baselineJpeg.slice();
const dht = undecodableJpeg.findIndex((byte, index) => byte === 0xff && undecodableJpeg[index + 1] === 0xc4);
undecodableJpeg.fill(0, dht + 5, dht + 21);
undecodableJpeg[dht + 5] = 12;

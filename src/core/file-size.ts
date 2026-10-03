/** Decimal units describe source bytes, not the size after conversion or archiving. */
export function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1000 && index < units.length - 1) { value /= 1000; index += 1; }
  return `${index === 0 ? value : value.toFixed(1)} ${units[index]}`;
}

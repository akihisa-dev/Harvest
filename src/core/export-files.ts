/** Use the page title for one file and a stable sequence for multiple videos. */
export function individualFilename(zipFilename: string, entryFilename: string, count: number): string {
  const base = zipFilename.replace(/\.zip$/i, "");
  return count === 1 ? `${base}.${entryFilename.split(".").pop()}` : `${base}_${entryFilename}`;
}

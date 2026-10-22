/** Harvest uses exactly three components within Chrome's manifest version range. */
export function extensionVersionParts(version) {
  if (typeof version !== "string") return undefined;
  const match = /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/.exec(version);
  if (!match || match[0] !== version) return undefined;
  const parts = match.slice(1).map(Number);
  return parts.every(part => part <= 65535) && parts.some(part => part > 0) ? parts : undefined;
}

export function assertExtensionVersion(version, source = "version") {
  const parts = extensionVersionParts(version);
  if (!parts) {
    throw new Error(`${source}にはChrome拡張用の3つの整数を指定してください（各0〜65535、先頭の0・全桁0・接尾辞は不可）: ${version}`);
  }
  return parts;
}

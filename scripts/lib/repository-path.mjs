import path from "node:path";

export function repositoryPathsMatch(first, second, platform = process.platform) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const normalize = value => {
    const resolved = paths.resolve(value);
    return platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(first) === normalize(second);
}

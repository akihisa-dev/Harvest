/** Deterministic Chrome boundary for tests which only need a completed save. */
export function successfulDownloads(onStart = () => {}) {
  let next = 0;
  return {
    async download(options) { onStart(options); return ++next; },
    async search({id}) { return [{id, state: 'complete'}]; },
    onChanged: {addListener() {}, removeListener() {}},
  };
}

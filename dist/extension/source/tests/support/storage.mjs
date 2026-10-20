// Browser storage belongs to each fixture, independent of Node's Web Storage.
export function installMemoryStorage(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map();
  const storage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(String(key)) ?? null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); },
  };
  Object.defineProperty(globalThis, "localStorage", {configurable: true, writable: true, value: storage});
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete globalThis.localStorage;
  });
  return storage;
}

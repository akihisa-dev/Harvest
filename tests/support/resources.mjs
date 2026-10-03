// One owner per test, including resources acquired before a setup failure.
export class ResourceScope {
  #cleanups = [];
  #closing;

  defer(cleanup) {
    if (this.#closing) throw new Error("Resource scope is already closing");
    this.#cleanups.push(cleanup);
  }

  acquire(create, dispose) {
    if (this.#closing) throw new Error("Resource scope is already closing");
    const acquisition = Promise.resolve().then(create);
    // Register before acquisition: a timeout must also release a browser that
    // finishes launching after teardown begins.
    this.defer(async () => {
      let resource;
      try { resource = await acquisition; } catch { return; }
      await dispose(resource);
    });
    return acquisition.then(resource => {
      if (this.#closing) throw new Error("Resource scope closed during acquisition");
      return resource;
    });
  }

  close() {
    return this.#closing ??= Promise.resolve().then(async () => {
      const errors = [];
      for (const cleanup of this.#cleanups.reverse()) {
        try { await cleanup(); } catch (error) { errors.push(error); }
      }
      this.#cleanups = [];
      if (errors.length) throw new AggregateError(errors, "Test resource cleanup failed");
    });
  }
}

const scopes = new WeakMap();
export function resourcesFor(t) {
  if (!scopes.has(t)) {
    const scope = new ResourceScope();
    scopes.set(t, scope);
    t.after(() => scope.close());
  }
  return scopes.get(t);
}

/** Per-document transient cancellation, shared by independently injected scripts. */
export function controlYoutubeCapture(owner, create) {
    const key = Symbol.for("harvest.youtube.capture.controls");
    const host = window;
    const controls = host[key] ?? new Map();
    const previous = controls.get(owner);
    if (previous) {
        previous.cancelled = true;
        clearTimeout(previous.timer);
        controls.delete(owner);
    }
    if (create) {
        host[key] = controls;
        const state = { cancelled: false, timer: 0 };
        state.timer = window.setTimeout(() => { state.cancelled = true; controls.delete(owner); if (!controls.size)
            delete host[key]; }, 45000);
        controls.set(owner, state);
    }
    else if (!controls.size)
        delete host[key];
    return location.href;
}

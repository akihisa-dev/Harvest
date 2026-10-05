const defaultMotion = {
    duration: 240,
    easing: "cubic-bezier(.22,1,.36,1)",
};
export function prefersReducedMotion() {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
const runningMotion = new WeakMap();
function cancelMotion(element) {
    runningMotion.get(element)?.cancel();
    runningMotion.delete(element);
}
function startMotion(element, frames, options) {
    cancelMotion(element);
    const animation = element.animate(frames, { ...defaultMotion, ...options });
    runningMotion.set(element, animation);
    const clearFinishedMotion = () => {
        if (runningMotion.get(element) === animation)
            runningMotion.delete(element);
    };
    void animation.finished.then(clearFinishedMotion, clearFinishedMotion);
}
function fadeRemoved(element, rect, opacity, options, retainExit) {
    if (prefersReducedMotion() || typeof element.cloneNode !== "function" || !rect.width || !rect.height)
        return;
    const ghost = element.cloneNode(true);
    ghost.removeAttribute("id");
    ghost.querySelectorAll("[id]").forEach(child => child.removeAttribute("id"));
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    ghost.classList.add("motion-ghost");
    Object.assign(ghost.style, { position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${rect.width}px`, height: `${rect.height}px`, margin: "0", pointerEvents: "none", zIndex: "10" });
    // Keep selector-dependent thumbnail styling without leaving an interactive row in the list.
    const shell = document.createElement("ol");
    shell.className = "image-list motion-ghost-shell";
    shell.setAttribute("aria-hidden", "true");
    shell.inert = true;
    shell.append(ghost);
    document.body.append(shell);
    const release = retainExit?.(element, ghost);
    const animation = ghost.animate([{ opacity }, { opacity: 0 }], { ...defaultMotion, ...options });
    const cleanup = () => { release?.(); shell.remove(); };
    void animation.finished.then(cleanup, cleanup);
}
/** The panel list is row-major CSS grid (or a vertical flex list in fixtures).
 * Find its visible range by layout offsets, unaffected by our animated transforms.
 * Only this opt-in ordered layout supports the binary search. Other parents keep
 * the general keyed-motion path. Recompute clipping every time for scroll/resize.
 */
function visibleLayoutRects(elements) {
    if (typeof getComputedStyle !== "function" || !Number.isFinite(window.innerHeight)) {
        return new Map(elements.map(element => [element, element.getBoundingClientRect()]));
    }
    const rects = new Map();
    const first = elements[0], parent = first?.parentElement;
    if (!first || !parent)
        return rects;
    const layout = getComputedStyle(parent);
    if (layout.display !== "grid" && !(layout.display === "flex" && layout.flexDirection === "column")) {
        return new Map(elements.map(element => [element, element.getBoundingClientRect()]));
    }
    let left = 0, top = 0, right = window.innerWidth, bottom = window.innerHeight;
    for (let ancestor = parent; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        const clipsX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
        const clipsY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
        if (!clipsX && !clipsY)
            continue;
        const rect = ancestor.getBoundingClientRect();
        if (clipsX) {
            left = Math.max(left, rect.left + ancestor.clientLeft);
            right = Math.min(right, rect.left + ancestor.clientLeft + ancestor.clientWidth);
        }
        if (clipsY) {
            top = Math.max(top, rect.top + ancestor.clientTop);
            bottom = Math.min(bottom, rect.top + ancestor.clientTop + ancestor.clientHeight);
        }
    }
    if (left >= right || top >= bottom)
        return rects;
    const ordered = [...elements].sort((a, b) => Number(a.style.order) - Number(b.style.order));
    const anchor = ordered[0];
    if (ordered.some(element => element.offsetParent !== anchor.offsetParent)) {
        return new Map(elements.map(element => [element, element.getBoundingClientRect()]));
    }
    const anchorRect = anchor.getBoundingClientRect();
    const transform = runningMotion.has(anchor) ? getComputedStyle(anchor).transform : "none";
    const translation = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
    const base = anchorRect.top - anchor.offsetTop - translation;
    const lowerBound = (above) => {
        let low = 0, high = ordered.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (above(ordered[middle]))
                low = middle + 1;
            else
                high = middle;
        }
        return low;
    };
    const start = lowerBound(element => base + element.offsetTop + element.offsetHeight <= top - 1);
    const end = lowerBound(element => base + element.offsetTop < bottom + 1);
    const candidates = new Set(ordered.slice(start, end));
    // Interrupted rows can be visible outside their destination layout slots.
    for (const element of elements)
        if (runningMotion.has(element))
            candidates.add(element);
    for (const element of candidates) {
        const rect = element === anchor ? anchorRect : element.getBoundingClientRect();
        if (rect.right > left && rect.left < right && rect.bottom > top && rect.top < bottom)
            rects.set(element, rect);
    }
    return rects;
}
/** Reuses keyed children and animates their layout movement without replaying entry motion. */
export function reconcileKeyedChildren(parent, items, keyOf, create, update, options = {}) {
    const { animateLayout = true, visibleLayoutOnly = false, retainExit, ...motionOptions } = options;
    const animate = animateLayout && !prefersReducedMotion();
    const motion = { ...defaultMotion, ...motionOptions };
    const before = new Map();
    const opacity = new Map();
    const existing = new Map();
    for (const child of Array.from(parent.children)) {
        if (!child || typeof child.getBoundingClientRect !== "function")
            continue;
        const element = child;
        const key = element.dataset["motionKey"];
        if (key !== undefined) {
            existing.set(key, element);
        }
    }
    if (animate) {
        const rects = visibleLayoutOnly ? visibleLayoutRects([...existing.values()])
            : new Map([...existing.values()].map(element => [element, element.getBoundingClientRect()]));
        for (const [key, element] of existing) {
            const rect = rects.get(element);
            if (rect) {
                before.set(key, rect);
                if (runningMotion.has(element) && typeof getComputedStyle === "function")
                    opacity.set(key, Number(getComputedStyle(element).opacity));
            }
        }
    }
    // Measure visual positions before canceling transforms, including interrupted motion.
    if (animateLayout)
        for (const element of existing.values())
            if (runningMotion.has(element))
                cancelMotion(element);
    const next = new Map();
    items.forEach((item, index) => {
        const key = keyOf(item);
        const element = existing.get(key) ?? create(item);
        if (element.dataset["motionKey"] !== key)
            element.dataset["motionKey"] = key;
        update(element, item, index);
        next.set(key, element);
    });
    for (const [key, element] of existing) {
        const rect = before.get(key);
        if (!next.has(key) && rect)
            fadeRemoved(element, rect, opacity.get(key) ?? 1, motion, retainExit);
    }
    const nextChildren = [...next.values()];
    const currentChildren = Array.from(parent.children);
    // Keep focus and image layout intact when only selection/text has changed.
    if (currentChildren.length !== nextChildren.length || currentChildren.some((child, index) => child !== nextChildren[index])) {
        const currentSet = new Set(currentChildren);
        if (currentChildren.length === nextChildren.length && nextChildren.every(element => currentSet.has(element))
            && typeof parent.insertBefore === "function") {
            // A reorder does not need to detach every unaffected row and its preview.
            nextChildren.forEach((element, index) => {
                const current = parent.children[index];
                if (current !== element)
                    parent.insertBefore(element, current ?? null);
            });
        }
        else
            parent.replaceChildren(...nextChildren);
    }
    if (!animate)
        return next;
    const after = visibleLayoutOnly ? visibleLayoutRects(nextChildren) : new Map(nextChildren.map(element => [element, element.getBoundingClientRect()]));
    for (const [key, element] of next)
        if (before.has(key) && !after.has(element))
            after.set(element, element.getBoundingClientRect());
    for (const [key, element] of next) {
        const current = after.get(element);
        if (!current)
            continue;
        const previous = before.get(key);
        if (!previous) {
            startMotion(element, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }], motion);
            continue;
        }
        const x = previous.left - current.left;
        const y = previous.top - current.top;
        const fromOpacity = opacity.get(key) ?? 1;
        if (x === 0 && y === 0 && fromOpacity === 1)
            continue;
        startMotion(element, [{ opacity: fromOpacity, transform: `translate(${x}px, ${y}px)` }, { opacity: 1, transform: "translate(0, 0)" }], { duration: motion.duration, easing: motion.easing });
    }
    return next;
}
/** Retarget a drag preview from the current visual position, including mid-flight changes. */
export function animateLayoutChange(elements, update, skip) {
    const before = new Map(elements.map(element => [element, element.getBoundingClientRect()]));
    elements.forEach(cancelMotion);
    update();
    const after = new Map(elements.map(element => [element, element.getBoundingClientRect()]));
    if (prefersReducedMotion())
        return after;
    for (const element of elements) {
        if (element === skip)
            continue;
        const previous = before.get(element);
        const current = after.get(element);
        const x = previous.left - current.left;
        const y = previous.top - current.top;
        if (x || y)
            startMotion(element, [{ transform: `translate(${x}px, ${y}px)` }, { transform: "translate(0, 0)" }], defaultMotion);
    }
    return after;
}
export function setMotionText(element, text) {
    if (element.textContent === text)
        return;
    element.textContent = text;
    if (prefersReducedMotion()) {
        cancelMotion(element);
        return;
    }
    const opacity = runningMotion.has(element) && typeof getComputedStyle === "function"
        ? Number(getComputedStyle(element).opacity) : .65;
    startMotion(element, [{ opacity }, { opacity: 1 }], defaultMotion);
}

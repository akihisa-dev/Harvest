import { t } from "./localization.js";
export function createViewerController(options) {
    const elements = options.elements;
    let open = false;
    let currentUrl = null;
    let renderedUrl = null;
    let renderedItem = null;
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    let pointer = null;
    let lastThumbnailWheelAt = -Infinity;
    let imageTransitionId = 0;
    let imageTransitionCleanup = null;
    const thumbnailRows = new Map();
    const imageMotionItems = new WeakMap();
    function clearThumbnails() {
        for (const row of thumbnailRows.values()) {
            const image = row.children[0]?.children[0];
            if (image)
                options.previewLoader.clearImage(image);
        }
        thumbnailRows.clear();
        elements.thumbnails.replaceChildren();
    }
    function motionImages() {
        const query = elements.stage.querySelectorAll;
        return typeof query === "function" ? [...query.call(elements.stage, ".viewer-motion-image")] : [];
    }
    function updateTransform() {
        elements.image.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
        elements.zoomReset.textContent = `${Math.round(zoom * 100)}%`;
        elements.zoomOut.disabled = zoom <= 1;
        elements.zoomIn.disabled = zoom >= 8;
        elements.zoomReset.disabled = zoom === 1;
        elements.stage.dataset["pannable"] = String(zoom > 1);
    }
    function resetTransform() {
        if (pointer && elements.stage.hasPointerCapture(pointer.id)) {
            elements.stage.releasePointerCapture(pointer.id);
        }
        zoom = 1;
        panX = 0;
        panY = 0;
        pointer = null;
        delete elements.stage.dataset["panning"];
        updateTransform();
    }
    function zoomBy(factor, clientX, clientY) {
        if (!open || !currentUrl)
            return;
        const nextZoom = Math.min(8, Math.max(1, zoom * factor));
        if (nextZoom === zoom)
            return;
        const rect = elements.stage.getBoundingClientRect();
        const x = clientX === undefined ? 0 : clientX - rect.left - rect.width / 2;
        const y = clientY === undefined ? 0 : clientY - rect.top - rect.height / 2;
        const ratio = nextZoom / zoom;
        panX = x - (x - panX) * ratio;
        panY = y - (y - panY) * ratio;
        zoom = nextZoom;
        if (zoom === 1) {
            panX = 0;
            panY = 0;
        }
        updateTransform();
    }
    function renderThumbnails(pages, activeUrl) {
        const focusedUrl = [...thumbnailRows].find(([, row]) => row.children[0] === document.activeElement)?.[0];
        const pageUrls = new Set(pages.map(item => item.url));
        for (const [url, row] of thumbnailRows) {
            if (pageUrls.has(url))
                continue;
            const image = row.children[0]?.children[0];
            if (image)
                options.previewLoader.clearImage(image);
            thumbnailRows.delete(url);
        }
        const rows = pages.map((item, index) => {
            let row = thumbnailRows.get(item.url);
            if (!row) {
                row = document.createElement("li");
                const button = document.createElement("button");
                button.type = "button";
                const thumbnail = document.createElement("img");
                thumbnail.loading = "lazy";
                thumbnail.referrerPolicy = "no-referrer";
                thumbnail.draggable = false;
                const number = document.createElement("span");
                number.className = "viewer-thumb-number";
                button.append(thumbnail, number);
                button.addEventListener("click", () => {
                    currentUrl = item.url;
                    render();
                });
                row.append(button);
                thumbnailRows.set(item.url, row);
            }
            const button = row.children[0];
            const number = button.children[1];
            button.setAttribute("aria-current", String(item.url === activeUrl));
            button.setAttribute("aria-label", t("thumbnailAria", { index: index + 1, filename: options.getPageLabel(item) }));
            const thumbnail = button.children[0];
            options.previewLoader.set(thumbnail, item, item.url === activeUrl);
            number.textContent = String(index + 1);
            return row;
        });
        const previousRows = Array.from(elements.thumbnails.children);
        if (previousRows.length !== rows.length || rows.some((row, index) => row !== previousRows[index])) {
            elements.thumbnails.replaceChildren(...rows);
            if (focusedUrl) {
                const focusRow = thumbnailRows.get(focusedUrl) ?? thumbnailRows.get(activeUrl);
                focusRow?.children[0]?.focus({ preventScroll: true });
            }
        }
        if (renderedUrl !== activeUrl) {
            const active = thumbnailRows.get(activeUrl)?.children[0];
            active?.scrollIntoView({ block: "center", inline: "nearest",
                behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
                    || performance.now() - lastThumbnailWheelAt < 200 ? "instant" : "smooth" });
        }
    }
    function render() {
        const pages = options.getPages();
        const previousUrl = renderedUrl;
        const index = pages.findIndex(item => item.url === currentUrl);
        const currentIndex = index < 0 ? 0 : index;
        const current = pages[currentIndex];
        currentUrl = current?.url ?? null;
        elements.results.hidden = open;
        elements.viewer.hidden = !open;
        elements.toggle.disabled = options.isBusy() || options.getImageCount() === 0;
        elements.toggle.setAttribute("aria-pressed", String(open));
        elements.toggle.textContent = open ? t("backToImages") : t("viewerMode");
        elements.empty.hidden = Boolean(current);
        elements.page.hidden = !open || !current;
        // Keep the current page visible through the viewer exit without retaining pointer capture.
        if (!open && current) {
            if (pointer && elements.stage.hasPointerCapture(pointer.id))
                elements.stage.releasePointerCapture(pointer.id);
            pointer = null;
            delete elements.stage.dataset["panning"];
            return;
        }
        if (!current) {
            imageTransitionId += 1;
            imageTransitionCleanup?.();
            imageTransitionCleanup = null;
            for (const old of motionImages()) {
                options.previewLoader.clearImage(old);
                old.remove();
            }
            delete elements.image.dataset["motion"];
            delete elements.image.dataset["direction"];
            renderedUrl = null;
            renderedItem = null;
            const hadThumbnailFocus = [...thumbnailRows.values()].some(row => row.children[0] === document.activeElement);
            clearThumbnails();
            if (open && hadThumbnailFocus) {
                elements.empty.tabIndex = -1;
                elements.empty.focus({ preventScroll: true });
            }
            resetTransform();
            options.previewLoader.clearImage(elements.image);
            elements.image.removeAttribute("src");
            elements.image.alt = "";
            elements.position.textContent = "";
            elements.filename.textContent = "";
            return;
        }
        const priorImageTransform = elements.image.style.transform;
        const pageChanged = renderedUrl !== current.url;
        if (pageChanged)
            resetTransform();
        renderThumbnails(pages, current.url);
        if (pageChanged) {
            imageTransitionCleanup?.();
            imageTransitionCleanup = null;
            const existingOutgoing = motionImages();
            const hasActiveImage = elements.image.complete && elements.image.naturalWidth > 0 && Boolean(elements.image.currentSrc);
            const canAnimateImage = Boolean(previousUrl && previousUrl !== current.url
                && (existingOutgoing.length > 0 || hasActiveImage)
                && !current.url.startsWith("data:") && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
            const transitionId = ++imageTransitionId;
            if (canAnimateImage) {
                const previousIndex = pages.findIndex(item => item.url === previousUrl);
                const direction = currentIndex < previousIndex ? "previous" : "next";
                const ghosts = [];
                const snapshot = (source, sourceUrl) => {
                    const item = source === elements.image
                        ? renderedItem
                        : imageMotionItems.get(source) ?? pages.find(candidate => candidate.url === sourceUrl);
                    if (!item)
                        return;
                    const computed = getComputedStyle(source);
                    const ghost = document.createElement("img");
                    ghost.className = "viewer-motion-image";
                    ghost.alt = "";
                    ghost.draggable = false;
                    ghost.dataset["motion"] = "holding";
                    ghost.dataset["direction"] = direction;
                    ghost.dataset["motionUrl"] = item.url;
                    imageMotionItems.set(ghost, item);
                    ghost.style.transform = source === elements.image ? priorImageTransform : computed.transform;
                    ghost.style.opacity = computed.opacity;
                    ghost.style.translate = computed.translate;
                    elements.stage.append(ghost);
                    options.previewLoader.set(ghost, item, true);
                    ghosts.push(ghost);
                };
                const retained = new Set(existingOutgoing
                    .filter(old => Number(getComputedStyle(old).opacity) > .05)
                    .sort((a, b) => Number(getComputedStyle(b).opacity) - Number(getComputedStyle(a).opacity))
                    .slice(0, 3));
                for (const old of existingOutgoing) {
                    if (retained.has(old))
                        snapshot(old, old.dataset["motionUrl"] ?? "");
                    old.getAnimations().forEach(animation => animation.cancel());
                    options.previewLoader.clearImage(old);
                    old.remove();
                }
                if (hasActiveImage && previousUrl) {
                    snapshot(elements.image, previousUrl);
                    elements.image.getAnimations().forEach(animation => animation.cancel());
                }
                let failureObserver = null;
                const cleanupListeners = () => {
                    elements.image.removeEventListener("load", onLoaded);
                    elements.image.removeEventListener("error", onFailed);
                    failureObserver?.disconnect();
                    failureObserver = null;
                };
                const onLoaded = () => {
                    cleanupListeners();
                    if (imageTransitionCleanup === cleanupListeners)
                        imageTransitionCleanup = null;
                    if (transitionId !== imageTransitionId || currentUrl !== current.url)
                        return;
                    elements.image.dataset["motion"] = "incoming";
                    elements.image.dataset["direction"] = direction;
                    const enterX = direction === "next" ? "20px" : "-20px";
                    const leaveX = direction === "next" ? "-20px" : "20px";
                    const animations = [elements.image.animate([
                            { opacity: 0, translate: `${enterX} 0` },
                            { opacity: 1, translate: "0 0" },
                        ], { duration: 210, easing: "cubic-bezier(.2, .7, .2, 1)" })];
                    for (const ghost of ghosts) {
                        ghost.dataset["motion"] = "outgoing";
                        animations.push(ghost.animate([
                            { opacity: getComputedStyle(ghost).opacity, translate: getComputedStyle(ghost).translate },
                            { opacity: 0, translate: leaveX + " 0" },
                        ], { duration: 210, easing: "cubic-bezier(.2, .7, .2, 1)" }));
                    }
                    void Promise.all(animations.map(animation => animation.finished.catch(() => undefined))).then(() => {
                        if (transitionId !== imageTransitionId)
                            return;
                        for (const ghost of ghosts) {
                            options.previewLoader.clearImage(ghost);
                            ghost.remove();
                        }
                        delete elements.image.dataset["motion"];
                        delete elements.image.dataset["direction"];
                    });
                };
                const onFailed = () => {
                    cleanupListeners();
                    if (imageTransitionCleanup === cleanupListeners)
                        imageTransitionCleanup = null;
                    if (transitionId !== imageTransitionId)
                        return;
                    for (const ghost of ghosts) {
                        options.previewLoader.clearImage(ghost);
                        ghost.remove();
                    }
                };
                elements.image.addEventListener("load", onLoaded);
                elements.image.addEventListener("error", onFailed);
                failureObserver = new MutationObserver(() => {
                    if (elements.image.dataset["previewFailed"] === "true")
                        onFailed();
                });
                failureObserver.observe(elements.image, { attributes: true, attributeFilter: ["data-preview-failed"] });
                imageTransitionCleanup = cleanupListeners;
            }
            else {
                imageTransitionCleanup?.();
                imageTransitionCleanup = null;
                for (const old of motionImages()) {
                    options.previewLoader.clearImage(old);
                    old.remove();
                }
                delete elements.image.dataset["motion"];
                delete elements.image.dataset["direction"];
            }
            options.previewLoader.set(elements.image, current, true);
            renderedUrl = current.url;
            renderedItem = current;
        }
        elements.image.alt = t("selectedImageAlt", { index: currentIndex + 1 });
        elements.position.textContent = `${currentIndex + 1} / ${pages.length}`;
        elements.filename.textContent = options.getPageLabel(current);
        elements.previous.disabled = options.isBusy() || currentIndex === 0;
        elements.next.disabled = options.isBusy() || currentIndex === pages.length - 1;
    }
    elements.toggle.addEventListener("click", () => {
        if (options.isBusy() || options.getImageCount() === 0)
            return;
        open = !open;
        options.onChange();
    });
    elements.previous.addEventListener("click", () => {
        const pages = options.getPages();
        const index = pages.findIndex(item => item.url === currentUrl);
        if (index > 0) {
            currentUrl = pages[index - 1].url;
            render();
        }
    });
    elements.next.addEventListener("click", () => {
        const pages = options.getPages();
        const index = pages.findIndex(item => item.url === currentUrl);
        if (index >= 0 && index < pages.length - 1) {
            currentUrl = pages[index + 1].url;
            render();
        }
    });
    elements.thumbnails.addEventListener("wheel", event => {
        if (!open || !currentUrl || options.isBusy())
            return;
        const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
        if (delta === 0 || event.timeStamp - lastThumbnailWheelAt < 180)
            return;
        const pages = options.getPages();
        const index = pages.findIndex(item => item.url === currentUrl);
        const nextIndex = Math.max(0, Math.min(pages.length - 1, index + Math.sign(delta)));
        if (index < 0 || nextIndex === index)
            return;
        event.preventDefault();
        lastThumbnailWheelAt = event.timeStamp;
        currentUrl = pages[nextIndex].url;
        render();
    }, { passive: false });
    elements.zoomIn.addEventListener("click", () => zoomBy(1.25));
    elements.zoomOut.addEventListener("click", () => zoomBy(1 / 1.25));
    elements.zoomReset.addEventListener("click", resetTransform);
    elements.stage.addEventListener("wheel", event => {
        if (!open || !currentUrl)
            return;
        event.preventDefault();
        zoomBy(Math.exp(-event.deltaY * 0.001), event.clientX, event.clientY);
    }, { passive: false });
    elements.stage.addEventListener("pointerdown", event => {
        if (!open || zoom <= 1 || (event.button !== undefined && event.button !== 0))
            return;
        event.preventDefault();
        pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, panX, panY };
        elements.stage.setPointerCapture(event.pointerId);
        elements.stage.dataset["panning"] = "true";
    });
    elements.stage.addEventListener("pointermove", event => {
        if (!pointer || pointer.id !== event.pointerId)
            return;
        panX = pointer.panX + event.clientX - pointer.x;
        panY = pointer.panY + event.clientY - pointer.y;
        updateTransform();
    });
    const endPan = (event) => {
        if (!pointer || pointer.id !== event.pointerId)
            return;
        pointer = null;
        if (elements.stage.hasPointerCapture(event.pointerId))
            elements.stage.releasePointerCapture(event.pointerId);
        delete elements.stage.dataset["panning"];
    };
    elements.stage.addEventListener("pointerup", endPan);
    elements.stage.addEventListener("pointercancel", endPan);
    return {
        get isOpen() { return open; },
        setOpen(value) { open = value; },
        clearCurrentPage() { currentUrl = null; },
        render,
    };
}

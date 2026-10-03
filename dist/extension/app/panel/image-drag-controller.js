import { createPreviewOrder, findNearestByRect, isPointerAfter } from "../../core/image-reorder.js";
import { animateLayoutChange } from "./motion.js";
/** Owns one drag's preview order, measured geometry, subscriptions and cleanup. */
export function createImageDragController(options) {
    const { imagesElement } = options;
    let visibleImages = [];
    let rows = new Map();
    let previewOrder = [];
    let session = null;
    let suppressClick = false;
    function refreshGeometry(drag, layoutChanged = false) {
        // A resize measures final slots after settling any in-flight motion offset.
        const settled = layoutChanged ? animateLayoutChange([...rows.values()], () => { }, rows.get(drag.item.url)) : null;
        drag.rects = new Map([...rows].map(([url, row]) => [url, settled?.get(row) ?? row.getBoundingClientRect()]));
        const first = drag.rects.values().next().value;
        drag.singleColumn = !first || [...drag.rects.values()].every(rect => Math.abs(rect.left - first.left) < 1);
        for (const [element, offset] of drag.scrollOffsets) {
            offset.left = element.scrollLeft;
            offset.top = element.scrollTop;
        }
        drag.layoutSize = { width: imagesElement.clientWidth, height: imagesElement.clientHeight };
        drag.layoutChanged = false;
    }
    function updateGeometry(drag) {
        if (drag.layoutChanged || imagesElement.clientWidth !== drag.layoutSize.width || imagesElement.clientHeight !== drag.layoutSize.height) {
            refreshGeometry(drag, true);
            return;
        }
        let x = 0;
        let y = 0;
        for (const [element, offset] of drag.scrollOffsets) {
            x += offset.left - element.scrollLeft;
            y += offset.top - element.scrollTop;
            offset.left = element.scrollLeft;
            offset.top = element.scrollTop;
        }
        if (!x && !y)
            return;
        for (const [url, rect] of drag.rects)
            drag.rects.set(url, {
                left: rect.left + x, right: rect.right + x, top: rect.top + y, bottom: rect.bottom + y,
                width: rect.width, height: rect.height,
            });
    }
    function showInsertion(order) {
        const changedItems = order.filter((item, index) => previewOrder[index] !== item);
        const changedRows = changedItems.flatMap(item => {
            const row = rows.get(item.url);
            return row ? [row] : [];
        });
        previewOrder = order;
        const updatedRects = animateLayoutChange(changedRows, () => {
            order.forEach((item, index) => { rows.get(item.url).style.order = String(index); });
        }, session ? rows.get(session.item.url) : undefined);
        for (const item of changedItems) {
            const row = rows.get(item.url);
            const rect = row ? updatedRects.get(row) : undefined;
            if (rect)
                session?.rects.set(item.url, rect);
        }
    }
    function updatePreview(drag, pointer) {
        if (options.isBusy() || session !== drag)
            return;
        updateGeometry(drag);
        const nearestUrl = findNearestByRect(drag.rects, pointer);
        const target = nearestUrl ? options.getItem(nearestUrl) : undefined;
        if (!target || drag.item === target)
            return;
        const rect = drag.rects.get(target.url);
        if (!rect)
            return;
        const order = createPreviewOrder(previewOrder, drag.item, target, isPointerAfter(rect, pointer, drag.singleColumn));
        if (order?.some((item, index) => item !== previewOrder[index]))
            showInsertion(order);
    }
    function schedulePreview() {
        const drag = session;
        if (!drag?.pointer || drag.geometryFrame !== null)
            return;
        drag.geometryFrame = window.requestAnimationFrame(() => {
            drag.geometryFrame = null;
            if (drag.pointer)
                updatePreview(drag, drag.pointer);
        });
    }
    function resizeLayout() {
        if (!session)
            return;
        session.layoutChanged = true;
        schedulePreview();
    }
    function start(item) {
        const drag = {
            item, overflowAnchor: imagesElement.style.overflowAnchor ?? "", scrollOffsets: new Map(), rects: new Map(),
            singleColumn: true, layoutChanged: false, layoutSize: { width: 0, height: 0 },
            resizeObserver: null, geometryFrame: null, pointer: null,
        };
        session = drag;
        // Browser scroll anchoring must not undo an intentional preview reorder.
        imagesElement.style.overflowAnchor = "none";
        for (let element = imagesElement; element; element = element.parentElement) {
            drag.scrollOffsets.set(element, { left: element.scrollLeft, top: element.scrollTop });
        }
        refreshGeometry(drag);
        document.addEventListener("scroll", schedulePreview, true);
        window.addEventListener?.("resize", resizeLayout);
        if (typeof ResizeObserver !== "undefined") {
            drag.resizeObserver = new ResizeObserver(() => {
                if (session === drag && (imagesElement.clientWidth !== drag.layoutSize.width || imagesElement.clientHeight !== drag.layoutSize.height))
                    resizeLayout();
            });
            drag.resizeObserver.observe(imagesElement);
        }
    }
    function stop(drag) {
        document.removeEventListener?.("scroll", schedulePreview, true);
        window.removeEventListener?.("resize", resizeLayout);
        drag.resizeObserver?.disconnect();
        if (drag.geometryFrame !== null)
            window.cancelAnimationFrame(drag.geometryFrame);
        drag.pointer = null;
        drag.scrollOffsets.clear();
        drag.rects.clear();
        imagesElement.style.overflowAnchor = drag.overflowAnchor;
    }
    function previewInsertion(event) {
        const drag = session;
        if (options.isBusy() || !drag)
            return;
        event.preventDefault();
        event.stopPropagation?.();
        if (event.dataTransfer)
            event.dataTransfer.dropEffect = "move";
        drag.pointer = { clientX: event.clientX, clientY: event.clientY };
        updatePreview(drag, drag.pointer);
    }
    function finishDrop(event) {
        const drag = session;
        if (!drag || options.isBusy())
            return;
        event.preventDefault();
        session = null;
        stop(drag);
        options.onDrop(visibleImages, previewOrder, drag.item);
    }
    imagesElement.ondragover = previewInsertion;
    imagesElement.ondrop = finishDrop;
    return {
        get draggedImage() { return session?.item ?? null; },
        get suppressClick() { return suppressClick; },
        setRows(visible, nextRows) {
            visibleImages = visible;
            previewOrder = [...visible];
            rows = nextRows;
        },
        bindRow(row, preview, getItem) {
            row.addEventListener("pointerdown", () => { suppressClick = false; });
            row.addEventListener("dragstart", event => {
                if (options.isBusy()) {
                    event.preventDefault();
                    return;
                }
                suppressClick = true;
                start(getItem());
                if (event.dataTransfer) {
                    event.dataTransfer.setDragImage(preview, preview.width / 2, preview.height / 2);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", "harvest-image");
                }
                row.classList.add("dragging");
            });
            row.addEventListener("dragover", previewInsertion);
            row.addEventListener("drop", finishDrop);
            row.addEventListener("dragend", () => {
                const drag = session;
                if (!drag)
                    return;
                session = null;
                row.classList.remove("dragging");
                showInsertion([...visibleImages]);
                stop(drag);
            });
        },
    };
}

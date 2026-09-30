import { animateLayoutChange, reconcileKeyedChildren } from "./motion.js";
import { formatFailedAria, formatGroupLabel, t } from "./localization.js";
import { createPreviewOrder, findNearestByRect, isPointerAfter } from "./image-reorder.js";
function listItemKey(item) {
    return item.kind === "source" ? "source-preview" : `image:${item.image.url}`;
}
/** Owns group visibility and the image-list DOM interactions for one collection. */
export function createImageListView(options) {
    const { collection, allVisibilityButton, groupsElement, imagesElement } = options;
    let visibleGroupKeys = new Set();
    let draggedImage = null;
    let suppressThumbnailClick = false;
    let focusTarget = null;
    const imageRowParts = new WeakMap();
    let visibleImages = [];
    let previewOrder = [];
    let rows = new Map();
    let dragRects = new Map();
    let dragIsSingleColumn = true;
    function refreshDragGeometry() {
        dragRects = new Map([...rows].map(([url, row]) => [url, row.getBoundingClientRect()]));
        const first = dragRects.values().next().value;
        dragIsSingleColumn = !first || [...dragRects.values()].every(rect => Math.abs(rect.left - first.left) < 1);
    }
    function requestFocus(target) {
        focusTarget = target;
    }
    function restoreFocus() {
        const target = focusTarget;
        focusTarget = null;
        if (!target)
            return;
        for (const element of document.querySelectorAll("[data-focus-kind]")) {
            if (element.getAttribute("data-focus-kind") !== target.kind)
                continue;
            if (target.kind === "group" || target.kind === "pdf-group") {
                if (element.getAttribute("data-focus-key") !== target.key)
                    continue;
            }
            else if (element.getAttribute("data-focus-url") !== target.url ||
                element.getAttribute("data-focus-action") !== target.action)
                continue;
            if (document.activeElement !== element)
                element.focus();
            return;
        }
    }
    function renderEye(button, shown, label) {
        if (button.children.length === 0) {
            const eye = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            eye.classList.add("eye-icon");
            eye.setAttribute("viewBox", "0 0 24 24");
            eye.setAttribute("aria-hidden", "true");
            const outline = document.createElementNS("http://www.w3.org/2000/svg", "path");
            outline.setAttribute("d", "M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z");
            const pupil = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            pupil.setAttribute("cx", "12");
            pupil.setAttribute("cy", "12");
            pupil.setAttribute("r", "2.5");
            eye.append(outline, pupil);
            {
                const gap = document.createElementNS("http://www.w3.org/2000/svg", "path");
                gap.setAttribute("d", "M3 21 21 3");
                gap.classList.add("eye-slash-gap");
                const slash = document.createElementNS("http://www.w3.org/2000/svg", "path");
                slash.setAttribute("d", "M3 21 21 3");
                slash.classList.add("eye-slash");
                eye.append(gap, slash);
            }
            button.replaceChildren(eye);
        }
        button.dataset["shown"] = String(shown);
        button.title = t(shown ? "hideGroup" : "displayGroup", { label });
        button.setAttribute("aria-label", button.title);
        button.setAttribute("aria-pressed", String(shown));
    }
    function renderGroups() {
        const groups = collection.groups;
        groupsElement.hidden = Object.keys(groups).length === 0;
        const entries = groupsElement.hidden ? [] : Object.entries(groups).sort((a, b) => a[1].priority - b[1].priority);
        reconcileKeyedChildren(groupsElement, entries.map(([key]) => key), key => key, key => {
            const label = document.createElement("span");
            label.className = "group-label";
            const button = document.createElement("button");
            button.type = "button";
            button.addEventListener("click", () => {
                requestFocus({ kind: "group", key });
                if (visibleGroupKeys.has(key))
                    visibleGroupKeys.delete(key);
                else
                    visibleGroupKeys.add(key);
                options.onChange();
            });
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.addEventListener("change", () => {
                if (options.isBusy() || !collection.groups[key])
                    return;
                requestFocus({ kind: "pdf-group", key });
                collection.setGroupSelected(key, checkbox.checked);
                options.onChange();
            });
            const checkboxLabel = document.createElement("label");
            checkboxLabel.className = "group-check";
            checkboxLabel.append(checkbox);
            const chip = document.createElement("div");
            chip.className = "group-chip";
            chip.append(label, button, checkboxLabel);
            return chip;
        }, (element, key) => {
            const group = groups[key];
            const groupLabel = formatGroupLabel(group?.label ?? "");
            element.children[0].textContent = groupLabel.replace(/ (\([^()]+\))$/, "\n$1");
            const button = element.children[1];
            renderEye(button, visibleGroupKeys.has(key), groupLabel);
            button.disabled = options.isBusy();
            button.setAttribute("data-focus-kind", "group");
            button.setAttribute("data-focus-key", key);
            const checkbox = element.children[2].children[0];
            const selection = collection.groupSelection(key);
            checkbox.checked = selection.checked;
            checkbox.indeterminate = selection.indeterminate;
            checkbox.disabled = options.isBusy();
            checkbox.setAttribute("data-focus-kind", "pdf-group");
            checkbox.setAttribute("data-focus-key", key);
            checkbox.setAttribute("aria-label", t("includeGroup", { label: groupLabel }));
        });
    }
    function toggleAllGroups() {
        if (options.isBusy() || allVisibilityButton.disabled)
            return;
        const groupKeys = Object.keys(collection.groups);
        const allVisible = groupKeys.length > 0 && visibleGroupKeys.size === groupKeys.length;
        visibleGroupKeys = allVisible ? new Set() : new Set(groupKeys);
        options.onChange();
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
        }, draggedImage ? rows.get(draggedImage.url) : undefined);
        for (const item of changedItems) {
            const row = rows.get(item.url);
            const rect = row ? updatedRects.get(row) : undefined;
            if (rect)
                dragRects.set(item.url, rect);
        }
    }
    function moveImage(source, target) {
        if (options.isBusy() || !collection.moveVisible(visibleImages, source, target))
            return;
        requestFocus({ kind: "image", url: source.url, action: "drag" });
        options.onChange();
    }
    function previewInsertion(target, event) {
        if (options.isBusy() || !draggedImage || draggedImage === target)
            return;
        event.preventDefault();
        if (event.dataTransfer)
            event.dataTransfer.dropEffect = "move";
        const row = rows.get(target.url);
        if (!row)
            return;
        const rect = dragRects.get(target.url);
        if (!rect)
            return;
        const order = createPreviewOrder(previewOrder, draggedImage, target, isPointerAfter(rect, event, dragIsSingleColumn));
        if (!order)
            return;
        if (order.some((item, index) => item !== previewOrder[index]))
            showInsertion(order);
    }
    function finishDrop(event) {
        if (!draggedImage || options.isBusy())
            return;
        event.preventDefault();
        const source = draggedImage;
        collection.applyVisibleOrder(visibleImages, previewOrder);
        draggedImage = null;
        dragRects.clear();
        requestFocus({ kind: "image", url: source.url, action: "drag" });
        options.onChange();
    }
    function createImageRow(initialItem) {
        const currentItem = () => collection.itemForUrl(initialItem.url);
        const row = document.createElement("li");
        const preview = document.createElement("img");
        preview.className = "preview";
        preview.loading = "lazy";
        preview.referrerPolicy = "no-referrer";
        preview.draggable = false;
        const body = document.createElement("div");
        body.className = "item-body";
        const order = document.createElement("span");
        order.className = "item-order";
        const name = document.createElement("span");
        name.className = "item-title";
        const selectedMark = document.createElement("span");
        selectedMark.className = "item-selected";
        selectedMark.textContent = "✓";
        selectedMark.setAttribute("aria-hidden", "true");
        const failedMark = document.createElement("span");
        failedMark.className = "item-failed";
        failedMark.textContent = t("imageFailed");
        body.append(order, name, selectedMark, failedMark);
        row.append(preview, body);
        imageRowParts.set(row, { preview, order, name, selectedMark, failedMark });
        row.addEventListener("pointerdown", () => { suppressThumbnailClick = false; });
        row.addEventListener("click", () => {
            if (suppressThumbnailClick || draggedImage || options.isBusy())
                return;
            const item = currentItem();
            collection.toggleSelected(item.url);
            requestFocus({ kind: "image", url: item.url, action: "drag" });
            options.onChange();
        });
        row.addEventListener("dragstart", event => {
            if (options.isBusy()) {
                event.preventDefault();
                return;
            }
            const item = currentItem();
            suppressThumbnailClick = true;
            draggedImage = item;
            refreshDragGeometry();
            if (event.dataTransfer) {
                event.dataTransfer.setDragImage(preview, preview.width / 2, preview.height / 2);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", "harvest-image");
            }
            row.classList.add("dragging");
        });
        row.addEventListener("dragover", event => previewInsertion(currentItem(), event));
        row.addEventListener("drop", finishDrop);
        row.addEventListener("dragend", () => {
            if (!draggedImage)
                return;
            draggedImage = null;
            dragRects.clear();
            row.classList.remove("dragging");
            showInsertion([...visibleImages]);
        });
        row.addEventListener("keydown", event => {
            if (event.target !== row || options.isBusy())
                return;
            const item = currentItem();
            if (!event.altKey && ["Enter", " "].includes(event.key)) {
                event.preventDefault();
                if (!event.repeat && !draggedImage && !options.isBusy()) {
                    collection.toggleSelected(item.url);
                    requestFocus({ kind: "image", url: item.url, action: "drag" });
                    options.onChange();
                }
                return;
            }
            if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key))
                return;
            event.preventDefault();
            const index = visibleImages.indexOf(item);
            const target = visibleImages[index + (event.key === "ArrowUp" ? -1 : 1)];
            if (target)
                moveImage(item, target);
        });
        return row;
    }
    function renderImages(failedItems, sourcePreview) {
        previewOrder = [...visibleImages];
        const previousRows = rows;
        const previousUrls = [...previousRows.keys()];
        const layoutChanged = previousUrls.length !== visibleImages.length ||
            visibleImages.some((item, index) => previousUrls[index] !== item.url);
        const listItems = visibleImages.map(image => ({ kind: "image", image }));
        if (sourcePreview)
            listItems.push({ kind: "source", image: sourcePreview });
        const nextListRows = reconcileKeyedChildren(imagesElement, listItems, listItemKey, item => item.kind === "image" ? createImageRow(item.image) : document.createElement("li"), (row, listItem, index) => {
            if (listItem.kind === "source") {
                row.className = "source-preview";
                row.style.order = String(index);
                const preview = row.children[0];
                if (preview) {
                    if (preview.getAttribute("src") !== listItem.image.url)
                        preview.setAttribute("src", listItem.image.url);
                }
                else {
                    const sourcePreviewImage = document.createElement("img");
                    sourcePreviewImage.className = "preview";
                    sourcePreviewImage.setAttribute("src", listItem.image.url);
                    sourcePreviewImage.alt = "Source";
                    const name = document.createElement("div");
                    name.className = "item-body";
                    name.textContent = "Source";
                    row.append(sourcePreviewImage, name);
                }
                return;
            }
            const item = listItem.image;
            const parts = imageRowParts.get(row);
            if (!parts)
                return;
            const overallIndex = collection.positionOf(item);
            row.style.order = String(index);
            if (item.selected)
                row.classList.remove("unselected");
            else
                row.classList.add("unselected");
            const failed = failedItems.has(item);
            if (failed)
                row.classList.add("failed");
            else
                row.classList.remove("failed");
            if (draggedImage !== item)
                row.classList.remove("dragging");
            row.setAttribute("role", "button");
            row.setAttribute("aria-pressed", String(item.selected));
            row.setAttribute("aria-disabled", String(options.isBusy()));
            row.draggable = !options.isBusy();
            row.tabIndex = 0;
            row.title = t("imageRowTitle");
            row.dataset["dropLabel"] = t("dropImage");
            row.setAttribute("data-focus-kind", "image");
            row.setAttribute("data-focus-url", item.url);
            row.setAttribute("data-focus-action", "drag");
            row.setAttribute("aria-label", t("imageRowAria", {
                filename: options.getFilename(item.url), index: overallIndex + 1,
                failed: formatFailedAria(failed),
            }));
            options.previewLoader.set(parts.preview, item);
            parts.preview.alt = t("imageAlt", { index: index + 1 });
            parts.order.textContent = `${overallIndex + 1}`;
            parts.order.setAttribute("aria-label", t("imagePosition", { index: overallIndex + 1 }));
            parts.name.textContent = options.getFilename(item.url);
            parts.name.title = item.url;
            parts.selectedMark.hidden = false;
            parts.failedMark.hidden = !failed;
        }, { animateLayout: layoutChanged });
        const nextRows = new Map();
        for (const item of visibleImages) {
            const row = nextListRows.get(`image:${item.url}`);
            if (row)
                nextRows.set(item.url, row);
        }
        for (const [url, row] of previousRows) {
            if (nextRows.has(url))
                continue;
            const parts = imageRowParts.get(row);
            if (parts)
                options.previewLoader.clearImage(parts.preview);
        }
        rows = nextRows;
        imagesElement.ondragover = event => {
            if (!draggedImage || options.isBusy())
                return;
            event.preventDefault();
            const nearestUrl = findNearestByRect(dragRects, event);
            const nearest = nearestUrl ? collection.itemForUrl(nearestUrl) ?? null : null;
            if (nearest)
                previewInsertion(nearest, event);
        };
        imagesElement.ondrop = finishDrop;
    }
    function render(failedItems = new Set(), sourcePreview = null) {
        const groups = collection.groups;
        for (const key of visibleGroupKeys)
            if (!groups[key])
                visibleGroupKeys.delete(key);
        const visibleUrls = new Set([...visibleGroupKeys].flatMap(key => groups[key]?.items ?? []));
        visibleImages = collection.items.filter(item => visibleUrls.has(item.url));
        renderEye(allVisibilityButton, visibleGroupKeys.size === Object.keys(groups).length && Object.keys(groups).length > 0, t("allGroups"));
        allVisibilityButton.disabled = options.isBusy() || collection.items.length === 0;
        renderGroups();
        renderImages(failedItems, sourcePreview);
        restoreFocus();
    }
    allVisibilityButton.addEventListener("click", toggleAllGroups);
    return {
        get isDragging() { return draggedImage !== null; },
        showInitialGroup(key) {
            visibleGroupKeys = new Set(key === null ? Object.keys(collection.groups) : [key]);
        },
        clearVisibleGroups() { visibleGroupKeys.clear(); },
        render,
    };
}

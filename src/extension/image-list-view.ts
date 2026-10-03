import {createVideoSizeLoader} from "./video-size.js";
import type { ImageCollection } from "../core/image-collection.js";
import type { ImageItem } from "../core/images.js";
import { reconcileKeyedChildren } from "./motion.js";
import { formatFailedAria, formatGroupLabel, t } from "./localization.js";
import { createImageDragController } from "./image-drag-controller.js";
import type { ImagePreviewLoader } from "./image-preview.js";

interface ImageRowParts {
  preview: HTMLImageElement;
  resolution: HTMLSpanElement;
  order: HTMLSpanElement;
  name: HTMLSpanElement;
  updateResolution: () => void;
  selectedMark: HTMLSpanElement;
  failedMark: HTMLSpanElement;
}

type RenderedListItem = {readonly kind: "image"; readonly image: ImageItem} |
  {readonly kind: "source"; readonly image: ImageItem};

function listItemKey(item: RenderedListItem): string {
  return item.kind === "source" ? "source-preview" : `image:${item.image.url}`;
}

type FocusTarget =
  | {kind: "group"; key: string}
  | {kind: "pdf-group"; key: string}
  | {kind: "image"; url: string; action: "drag"};

export interface ImageListViewOptions {
  readonly collection: ImageCollection;
  readonly allVisibilityButton: HTMLButtonElement;
  readonly groupsElement: HTMLDivElement;
  readonly imagesElement: HTMLOListElement;
  readonly isBusy: () => boolean;
  readonly getFilename: (url: string) => string;
  readonly previewLoader: ImagePreviewLoader;
  readonly onChange: () => void;
}

export interface ImageListView {
  readonly diagnostics: {total: number; visible: number; hidden: number};
  readonly isDragging: boolean;
  showInitialGroup(key: string | null): void;
  clearVisibleGroups(): void;
  clearVideoSizes(): void;
  render(failedItems?: ReadonlySet<ImageItem>, sourcePreview?: ImageItem | null): void;
}

/** Owns group visibility and the image-list DOM interactions for one collection. */
export function createImageListView(options: ImageListViewOptions): ImageListView {
  const videoSizes = createVideoSizeLoader({loading: t("videoSizeLoading"), unknown: t("videoSizeUnknown")});
  window.addEventListener?.("pagehide", () => videoSizes.clear());
  const {collection, allVisibilityButton, groupsElement, imagesElement} = options;
  let visibleGroupKeys = new Set<string>();
  let focusTarget: FocusTarget | null = null;
  const imageRowParts = new WeakMap<HTMLLIElement, ImageRowParts>();
  let visibleImages: readonly ImageItem[] = [];
  let rows = new Map<string, HTMLLIElement>();
  let renderedListKeys: string[] = [];
  const drag = createImageDragController({
    imagesElement,
    isBusy: options.isBusy,
    getItem: url => collection.itemForUrl(url),
    onDrop(visible, order, source) {
      collection.applyVisibleOrder(visible, order);
      requestFocus({kind: "image", url: source.url, action: "drag"});
      options.onChange();
    },
  });

  function requestFocus(target: FocusTarget): void {
    focusTarget = target;
  }

  function restoreFocus(): void {
    const target = focusTarget;
    focusTarget = null;
    if (!target) return;
    for (const element of document.querySelectorAll<HTMLElement>("[data-focus-kind]")) {
      if (element.getAttribute("data-focus-kind") !== target.kind) continue;
      if (target.kind === "group" || target.kind === "pdf-group") {
        if (element.getAttribute("data-focus-key") !== target.key) continue;
      } else if (element.getAttribute("data-focus-url") !== target.url ||
                 element.getAttribute("data-focus-action") !== target.action) continue;
      if (document.activeElement !== element) element.focus();
      return;
    }
  }

  function renderEye(button: HTMLButtonElement, shown: boolean, label: string): void {
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
    button.title = t(shown ? "hideGroup" : "displayGroup", {label});
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", String(shown));
  }

  function renderGroups(): void {
    const groups = collection.groups;
    groupsElement.hidden = Object.keys(groups).length === 0;
    const entries = groupsElement.hidden ? [] : Object.entries(groups).sort((a, b) => a[1].priority - b[1].priority);
    reconcileKeyedChildren(groupsElement, entries.map(([key]) => key), key => key,
      key => {
        const label = document.createElement("span");
        label.className = "group-label";
        const button = document.createElement("button");
        button.type = "button";
        button.addEventListener("click", () => {
          requestFocus({kind: "group", key});
          if (visibleGroupKeys.has(key)) visibleGroupKeys.delete(key);
          else visibleGroupKeys.add(key);
          options.onChange();
        });
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.addEventListener("change", () => {
          if (options.isBusy() || !collection.groups[key]) return;
          requestFocus({kind: "pdf-group", key});
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
      },
      (element, key) => {
        const group = groups[key];
        let groupLabel = formatGroupLabel(group?.label ?? "");
        if (group?.items.some(url => {
          const kind = collection.itemForUrl(url)?.kind;
          return kind === "gif" || kind === "video";
        })) groupLabel = groupLabel.replace(/(\d+)枚/, "$1件").replace(/ image(s?)\)/, " file$1)");
        (element.children[0] as HTMLSpanElement).textContent = groupLabel.includes(" · ")
          ? groupLabel.replace(/^(.+) · (.+) (\([^()]+\))$/, "$2\n$1\n$3")
          : groupLabel.replace(/ (\([^()]+\))$/, "\n$1");
        const button = element.children[1] as HTMLButtonElement;
        renderEye(button, visibleGroupKeys.has(key), groupLabel);
        button.disabled = options.isBusy();
        button.setAttribute("data-focus-kind", "group");
        button.setAttribute("data-focus-key", key);
        const checkbox = element.children[2]!.children[0] as HTMLInputElement;
        const selection = collection.groupSelection(key);
        checkbox.checked = selection.checked;
        checkbox.indeterminate = selection.indeterminate;
        checkbox.disabled = options.isBusy();
        checkbox.setAttribute("data-focus-kind", "pdf-group");
        checkbox.setAttribute("data-focus-key", key);
        checkbox.setAttribute("aria-label", t("includeGroup", {label: groupLabel}));
      });
  }

  function toggleAllGroups(): void {
    if (options.isBusy() || allVisibilityButton.disabled) return;
    const groupKeys = Object.keys(collection.groups);
    const allVisible = groupKeys.length > 0 && visibleGroupKeys.size === groupKeys.length;
    visibleGroupKeys = allVisible ? new Set() : new Set(groupKeys);
    options.onChange();
  }

  function moveImage(source: ImageItem, target: ImageItem): void {
    if (options.isBusy() || !collection.moveVisible(visibleImages, source, target)) return;
    requestFocus({kind: "image", url: source.url, action: "drag"});
    options.onChange();
  }

  function createImageRow(initialItem: ImageItem): HTMLLIElement {
    const currentItem = (): ImageItem => collection.itemForUrl(initialItem.url)!;
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
    const resolution = document.createElement("span");
    resolution.className = "item-resolution";
    resolution.hidden = true;
    const updateResolution = (): void => {
      const item = currentItem();
      if (item?.kind === "video") { videoSizes.set(resolution, item); return; }
      videoSizes.release(resolution);
      // A video's poster or placeholder is not the video's resolution.
      const ready = item && preview.dataset["previewUrl"] === item.url
        && preview.complete && preview.naturalWidth > 0 && preview.naturalHeight > 0;
      resolution.hidden = !ready;
      resolution.textContent = ready ? `${preview.naturalWidth} × ${preview.naturalHeight}` : "";
    };
    preview.addEventListener("load", updateResolution);
    preview.addEventListener("error", () => {
      if (currentItem()?.kind === "video") { updateResolution(); return; }
      resolution.hidden = true;
      resolution.textContent = "";
    });
    const selectedMark = document.createElement("span");
    selectedMark.className = "item-selected";
    selectedMark.textContent = "✓";
    selectedMark.setAttribute("aria-hidden", "true");
    const failedMark = document.createElement("span");
    failedMark.className = "item-failed";
    failedMark.textContent = t("imageFailed");
    body.append(order, resolution, name, selectedMark, failedMark);
    row.append(preview, body);
    imageRowParts.set(row, {preview, resolution, order, name, updateResolution, selectedMark, failedMark});
    drag.bindRow(row, preview, currentItem);
    row.addEventListener("click", () => {
      if (drag.suppressClick || drag.draggedImage || options.isBusy()) return;
      const item = currentItem();
      collection.toggleSelected(item.url);
      requestFocus({kind: "image", url: item.url, action: "drag"});
      options.onChange();
    });
    row.addEventListener("keydown", event => {
      if (event.target !== row || options.isBusy()) return;
      const item = currentItem();
      if (!event.altKey && ["Enter", " "].includes(event.key)) {
        event.preventDefault();
        if (!event.repeat && !drag.draggedImage && !options.isBusy()) {
          collection.toggleSelected(item.url);
          requestFocus({kind: "image", url: item.url, action: "drag"});
          options.onChange();
        }
        return;
      }
      if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const index = visibleImages.indexOf(item);
      const target = visibleImages[index + (event.key === "ArrowUp" ? -1 : 1)];
      if (target) moveImage(item, target);
    });
    return row;
  }

  function renderSourceRow(row: HTMLLIElement, item: ImageItem, index: number): void {
    row.className = "source-preview";
    row.style.order = String(index);
    const preview = row.children[0] as HTMLImageElement | undefined;
    if (preview) {
      if (preview.getAttribute("src") !== item.url) preview.setAttribute("src", item.url);
    } else {
      const sourcePreviewImage = document.createElement("img");
      sourcePreviewImage.className = "preview";
      sourcePreviewImage.setAttribute("src", item.url);
      sourcePreviewImage.alt = "Source";
      const name = document.createElement("div");
      name.className = "item-body";
      name.textContent = "Source";
      row.append(sourcePreviewImage, name);
    }
  }

  function renderImageRow(row: HTMLLIElement, item: ImageItem, index: number, failedItems: ReadonlySet<ImageItem>): void {
    const parts = imageRowParts.get(row);
    if (!parts) return;
    const overallIndex = collection.positionOf(item)!;
    row.style.order = String(index);
    if (item.selected) row.classList.remove("unselected");
    else row.classList.add("unselected");
    const failed = failedItems.has(item);
    if (failed) row.classList.add("failed");
    else row.classList.remove("failed");
    if (drag.draggedImage !== item) row.classList.remove("dragging");
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
    parts.updateResolution();
    parts.preview.alt = t("imageAlt", {index: index + 1});
    parts.order.textContent = `${overallIndex + 1}`;
    parts.order.setAttribute("aria-label", t("imagePosition", {index: overallIndex + 1}));
    parts.name.textContent = (item.kind === "gif" ? "GIF · " : item.kind === "video" ? t("mediaKindVideo") + " · " : "") + options.getFilename(item.url);
    parts.name.title = item.url;
    parts.selectedMark.hidden = false;
    parts.failedMark.hidden = !failed;
  }

  function renderImages(failedItems: ReadonlySet<ImageItem>, sourcePreview: ImageItem | null): void {
    const previousRows = rows;
    const listItems: RenderedListItem[] = visibleImages.map(image => ({kind: "image", image}));
    if (sourcePreview) listItems.push({kind: "source", image: sourcePreview});
    const nextKeys = listItems.map(listItemKey);
    const layoutChanged = renderedListKeys.length !== nextKeys.length ||
      nextKeys.some((key, index) => renderedListKeys[index] !== key);
    const nextListRows = reconcileKeyedChildren(imagesElement, listItems, listItemKey,
      item => item.kind === "image" ? createImageRow(item.image) : document.createElement("li"),
      (row, listItem, index) => {
        if (listItem.kind === "source") renderSourceRow(row, listItem.image, index);
        else renderImageRow(row, listItem.image, index, failedItems);
      }, {animateLayout: layoutChanged});
    renderedListKeys = nextKeys;
    const nextRows = new Map<string, HTMLLIElement>();
    for (const item of visibleImages) {
      const row = nextListRows.get(`image:${item.url}`);
      if (row) nextRows.set(item.url, row);
    }
    for (const [url, row] of previousRows) {
      if (nextRows.has(url)) continue;
      const parts = imageRowParts.get(row);
      if (parts) {
        options.previewLoader.clearImage(parts.preview);
        videoSizes.release(parts.resolution);
      }
    }
    rows = nextRows;
    drag.setRows(visibleImages, rows);
  }

  function render(failedItems: ReadonlySet<ImageItem> = new Set(), sourcePreview: ImageItem | null = null): void {
    const groups = collection.groups;
    for (const key of visibleGroupKeys) if (!groups[key]) visibleGroupKeys.delete(key);
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
    get diagnostics() { return {total: collection.items.length, visible: visibleImages.length, hidden: collection.items.length - visibleImages.length}; },
    get isDragging() { return drag.draggedImage !== null; },
    showInitialGroup(key) {
      visibleGroupKeys = new Set(key === null ? Object.keys(collection.groups) : [key]);
    },
    clearVisibleGroups() { visibleGroupKeys.clear(); },
    clearVideoSizes() { videoSizes.clear(); },
    render,
  };
}

import type { ImageItem } from "../core/images.js";
import { t } from "./localization.js";

export interface ViewerElements {
  readonly toggle: HTMLButtonElement;
  readonly viewer: HTMLElement;
  readonly empty: HTMLParagraphElement;
  readonly page: HTMLDivElement;
  readonly previous: HTMLButtonElement;
  readonly next: HTMLButtonElement;
  readonly position: HTMLSpanElement;
  readonly stage: HTMLDivElement;
  readonly image: HTMLImageElement;
  readonly filename: HTMLParagraphElement;
  readonly thumbnails: HTMLOListElement;
  readonly zoomIn: HTMLButtonElement;
  readonly zoomOut: HTMLButtonElement;
  readonly zoomReset: HTMLButtonElement;
  readonly results: HTMLElement;
}

export interface ViewerControllerOptions {
  readonly elements: ViewerElements;
  readonly getPages: () => readonly ImageItem[];
  readonly getPageLabel: (item: ImageItem) => string;
  readonly isBusy: () => boolean;
  readonly getImageCount: () => number;
  readonly onChange: () => void;
}

export interface ViewerController {
  readonly isOpen: boolean;
  setOpen(open: boolean): void;
  clearCurrentPage(): void;
  render(): void;
}

export function createViewerController(options: ViewerControllerOptions): ViewerController {
  const elements = options.elements;
  let open = false;
  let currentUrl: string | null = null;
  let renderedUrl: string | null = null;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let pointer: {id: number; x: number; y: number; panX: number; panY: number} | null = null;
  const thumbnailRows = new Map<string, HTMLLIElement>();

  function updateTransform(): void {
    elements.image.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    elements.zoomReset.textContent = `${Math.round(zoom * 100)}%`;
    elements.zoomOut.disabled = zoom <= 1;
    elements.zoomIn.disabled = zoom >= 8;
    elements.zoomReset.disabled = zoom === 1;
    elements.stage.dataset["pannable"] = String(zoom > 1);
  }

  function resetTransform(): void {
    zoom = 1;
    panX = 0;
    panY = 0;
    pointer = null;
    delete elements.stage.dataset["panning"];
    updateTransform();
  }

  function zoomBy(factor: number, clientX?: number, clientY?: number): void {
    if (!open || !currentUrl) return;
    const nextZoom = Math.min(8, Math.max(1, zoom * factor));
    if (nextZoom === zoom) return;
    const rect = elements.stage.getBoundingClientRect();
    const x = clientX === undefined ? 0 : clientX - rect.left - rect.width / 2;
    const y = clientY === undefined ? 0 : clientY - rect.top - rect.height / 2;
    const ratio = nextZoom / zoom;
    panX = x - (x - panX) * ratio;
    panY = y - (y - panY) * ratio;
    zoom = nextZoom;
    if (zoom === 1) { panX = 0; panY = 0; }
    updateTransform();
  }

  function renderThumbnails(pages: readonly ImageItem[], activeUrl: string): void {
    const pageUrls = new Set(pages.map(item => item.url));
    for (const url of thumbnailRows.keys()) if (!pageUrls.has(url)) thumbnailRows.delete(url);
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
        thumbnail.src = item.url;
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
      const button = row.children[0] as HTMLButtonElement;
      const number = button.children[1] as HTMLSpanElement;
      button.setAttribute("aria-current", String(item.url === activeUrl));
      button.setAttribute("aria-label", t("thumbnailAria", {index: index + 1, filename: options.getPageLabel(item)}));
      number.textContent = String(index + 1);
      return row;
    });
    elements.thumbnails.replaceChildren(...rows);
    if (renderedUrl !== activeUrl) {
      const active = thumbnailRows.get(activeUrl)?.children[0] as HTMLButtonElement | undefined;
      active?.scrollIntoView({block: "nearest"});
    }
  }

  function render(): void {
    const pages = options.getPages();
    const index = pages.findIndex(item => item.url === currentUrl);
    const currentIndex = index < 0 ? 0 : index;
    const current = pages[currentIndex];
    currentUrl = current?.url ?? null;
    elements.results.hidden = open;
    elements.viewer.hidden = !open;
    elements.toggle.disabled = options.isBusy() || options.getImageCount() === 0;
    elements.toggle.setAttribute("aria-pressed", String(open));
    elements.toggle.textContent = open ? t("backToImages") : t("viewerMode");
    elements.empty.hidden = !open || Boolean(current);
    elements.page.hidden = !open || !current;
    if (!open || !current) {
      renderedUrl = null;
      thumbnailRows.clear();
      elements.thumbnails.replaceChildren();
      resetTransform();
      elements.image.removeAttribute("src");
      elements.image.alt = "";
      elements.position.textContent = "";
      elements.filename.textContent = "";
      return;
    }
    if (renderedUrl !== current.url) resetTransform();
    renderThumbnails(pages, current.url);
    if (elements.image.src !== current.url) elements.image.src = current.url;
    renderedUrl = current.url;
    elements.image.alt = t("selectedImageAlt", {index: currentIndex + 1});
    elements.position.textContent = `${currentIndex + 1} / ${pages.length}`;
    elements.filename.textContent = options.getPageLabel(current);
    elements.previous.disabled = options.isBusy() || currentIndex === 0;
    elements.next.disabled = options.isBusy() || currentIndex === pages.length - 1;
  }

  elements.toggle.addEventListener("click", () => {
    if (options.isBusy() || options.getImageCount() === 0) return;
    open = !open;
    options.onChange();
  });
  elements.previous.addEventListener("click", () => {
    const pages = options.getPages();
    const index = pages.findIndex(item => item.url === currentUrl);
    if (index > 0) { currentUrl = pages[index - 1]!.url; render(); }
  });
  elements.next.addEventListener("click", () => {
    const pages = options.getPages();
    const index = pages.findIndex(item => item.url === currentUrl);
    if (index >= 0 && index < pages.length - 1) { currentUrl = pages[index + 1]!.url; render(); }
  });
  elements.zoomIn.addEventListener("click", () => zoomBy(1.25));
  elements.zoomOut.addEventListener("click", () => zoomBy(1 / 1.25));
  elements.zoomReset.addEventListener("click", resetTransform);
  elements.stage.addEventListener("wheel", event => {
    if (!open || !currentUrl) return;
    event.preventDefault();
    zoomBy(Math.exp(-event.deltaY * 0.001), event.clientX, event.clientY);
  }, {passive: false});
  elements.stage.addEventListener("pointerdown", event => {
    if (!open || zoom <= 1 || (event.button !== undefined && event.button !== 0)) return;
    event.preventDefault();
    pointer = {id: event.pointerId, x: event.clientX, y: event.clientY, panX, panY};
    elements.stage.setPointerCapture(event.pointerId);
    elements.stage.dataset["panning"] = "true";
  });
  elements.stage.addEventListener("pointermove", event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    panX = pointer.panX + event.clientX - pointer.x;
    panY = pointer.panY + event.clientY - pointer.y;
    updateTransform();
  });
  const endPan = (event: PointerEvent): void => {
    if (!pointer || pointer.id !== event.pointerId) return;
    pointer = null;
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

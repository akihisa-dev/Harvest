import type { ImageItem } from "../core/images.js";
import type { ImagePreviewLoader } from "./image-preview.js";
import { prefersReducedMotion } from "./motion.js";

interface ViewerImageTransitionOptions {
  readonly stage: HTMLDivElement;
  readonly image: HTMLImageElement;
  readonly previewLoader: ImagePreviewLoader;
  readonly getCurrentUrl: () => string | null;
}

export interface ViewerImageTransition {
  readonly renderedUrl: string | null;
  show(current: ImageItem, pages: readonly ImageItem[], priorImageTransform: string): void;
  clear(): void;
}

/** Owns image bindings, pending load listeners and outgoing visual layers for the viewer. */
export function createViewerImageTransition(options: ViewerImageTransitionOptions): ViewerImageTransition {
  const {stage, image, previewLoader} = options;
  let renderedItem: ImageItem | null = null;
  let imageTransitionId = 0;
  let imageTransitionCleanup: (() => void) | null = null;
  const imageMotionItems = new WeakMap<HTMLImageElement, ImageItem>();

  function motionImages(): HTMLImageElement[] {
    const query = stage.querySelectorAll;
    return typeof query === "function" ? [...query.call(stage, ".viewer-motion-image")] as HTMLImageElement[] : [];
  }

  function clearOutgoing(): void {
    for (const old of motionImages()) {
      previewLoader.clearImage(old);
      old.remove();
    }
    delete image.dataset["motion"];
    delete image.dataset["direction"];
  }

  function cancelPendingLoad(): void {
    imageTransitionCleanup?.();
    imageTransitionCleanup = null;
  }

  function show(current: ImageItem, pages: readonly ImageItem[], priorImageTransform: string): void {
    const previousUrl = renderedItem?.url ?? null;
    const reusesPreview = renderedItem !== null
      && (renderedItem.previewUrl ?? renderedItem.url) === (current.previewUrl ?? current.url)
      && renderedItem.sourcePage === current.sourcePage;
    const currentIndex = pages.findIndex(item => item.url === current.url);
    cancelPendingLoad();
    const existingOutgoing = motionImages();
    const hasActiveImage = image.complete && image.naturalWidth > 0 && Boolean(image.currentSrc);
    const canAnimateImage = Boolean(previousUrl && previousUrl !== current.url
      && (existingOutgoing.length > 0 || hasActiveImage)
      && !current.url.startsWith("data:") && !prefersReducedMotion());
    const transitionId = ++imageTransitionId;
    let settleSharedPreview: (() => void) | null = null;
    if (canAnimateImage) {
      const previousIndex = pages.findIndex(item => item.url === previousUrl);
      const direction = currentIndex < previousIndex ? "previous" : "next";
      const ghosts: HTMLImageElement[] = [];
      const snapshot = (source: HTMLImageElement, sourceUrl: string): void => {
        const item = source === image
          ? renderedItem
          : imageMotionItems.get(source) ?? pages.find(candidate => candidate.url === sourceUrl);
        if (!item) return;
        const computed = getComputedStyle(source);
        const ghost = document.createElement("img");
        ghost.className = "viewer-motion-image";
        ghost.alt = "";
        ghost.draggable = false;
        ghost.dataset["motion"] = "holding";
        ghost.dataset["direction"] = direction;
        ghost.dataset["motionUrl"] = item.url;
        imageMotionItems.set(ghost, item);
        ghost.style.transform = source === image ? priorImageTransform : computed.transform;
        ghost.style.opacity = computed.opacity;
        ghost.style.translate = computed.translate;
        stage.append(ghost);
        previewLoader.set(ghost, item, true);
        ghosts.push(ghost);
      };
      const retained = new Set(existingOutgoing
        .filter(old => Number(getComputedStyle(old).opacity) > .05)
        .sort((a, b) => Number(getComputedStyle(b).opacity) - Number(getComputedStyle(a).opacity))
        .slice(0, 3));
      for (const old of existingOutgoing) {
        if (retained.has(old)) snapshot(old, old.dataset["motionUrl"] ?? "");
        old.getAnimations().forEach(animation => animation.cancel());
        previewLoader.clearImage(old);
        old.remove();
      }
      if (hasActiveImage && previousUrl) {
        snapshot(image, previousUrl);
        image.getAnimations().forEach(animation => animation.cancel());
      }
      let failureObserver: MutationObserver | null = null;
      const cleanupListeners = (): void => {
        image.removeEventListener("load", onLoaded);
        image.removeEventListener("error", onFailed);
        failureObserver?.disconnect();
        failureObserver = null;
      };
      const onLoaded = (): void => {
        cleanupListeners();
        if (imageTransitionCleanup === cleanupListeners) imageTransitionCleanup = null;
        if (transitionId !== imageTransitionId || options.getCurrentUrl() !== current.url) return;
        image.dataset["motion"] = "incoming";
        image.dataset["direction"] = direction;
        const enterX = direction === "next" ? "20px" : "-20px";
        const leaveX = direction === "next" ? "-20px" : "20px";
        const animations = [image.animate([
          {opacity: 0, translate: `${enterX} 0`},
          {opacity: 1, translate: "0 0"},
        ], {duration: 210, easing: "cubic-bezier(.2, .7, .2, 1)"})];
        for (const ghost of ghosts) {
          ghost.dataset["motion"] = "outgoing";
          animations.push(ghost.animate([
            {opacity: getComputedStyle(ghost).opacity, translate: getComputedStyle(ghost).translate},
            {opacity: 0, translate: leaveX + " 0"},
          ], {duration: 210, easing: "cubic-bezier(.2, .7, .2, 1)"}));
        }
        void Promise.all(animations.map(animation => animation.finished.catch(() => undefined))).then(() => {
          if (transitionId !== imageTransitionId) return;
          for (const ghost of ghosts) {
            previewLoader.clearImage(ghost);
            ghost.remove();
          }
          delete image.dataset["motion"];
          delete image.dataset["direction"];
        });
      };
      const onFailed = (): void => {
        cleanupListeners();
        if (imageTransitionCleanup === cleanupListeners) imageTransitionCleanup = null;
        if (transitionId !== imageTransitionId) return;
        for (const ghost of ghosts) {
          previewLoader.clearImage(ghost);
          ghost.remove();
        }
      };
      image.addEventListener("load", onLoaded);
      image.addEventListener("error", onFailed);
      failureObserver = new MutationObserver(() => {
        if (image.dataset["previewFailed"] === "true") onFailed();
      });
      failureObserver.observe(image, {attributes: true, attributeFilter: ["data-preview-failed"]});
      imageTransitionCleanup = cleanupListeners;
      settleSharedPreview = () => {
        if (image.dataset["previewFailed"] === "true") onFailed();
        else if (image.complete && image.naturalWidth > 0 && image.currentSrc) onLoaded();
      };
    } else {
      clearOutgoing();
    }
    previewLoader.set(image, current, true);
    renderedItem = current;
    // The loader keeps src unchanged for the same preview resource, so no new load event follows.
    if (reusesPreview) settleSharedPreview?.();
  }

  return {
    get renderedUrl() { return renderedItem?.url ?? null; },
    show,
    clear() {
      imageTransitionId += 1;
      cancelPendingLoad();
      clearOutgoing();
      renderedItem = null;
      previewLoader.clearImage(image);
      image.removeAttribute("src");
      image.alt = "";
    },
  };
}

import type { ImageItem } from "../../core/images.js";

/** Retry data shared by preparation and the panel that owns its lifetime. */
export interface MutablePendingExport<TPrepared> {
  readonly selected: readonly ImageItem[];
  readonly prepared: Map<ImageItem, TPrepared>;
  readonly failed: Map<ImageItem, string>;
}

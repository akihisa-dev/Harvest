import { defaultSelectedImageGroups, filterImagesByGroup, groupImages, type ImageGroups, type ImageItem } from "./images.js";

/** Owns one scan's image identities, selection, grouping, and user-defined order. */
export class ImageCollection {
  private orderedItems: ImageItem[] = [];
  private initialItems: ImageItem[] = [];
  private groupedItems: ImageGroups = {};
  private itemByUrl = new Map<string, ImageItem>();
  private positionByItem = new Map<ImageItem, number>();
  private itemsByGroup = new Map<string, ImageItem[]>();

  get items(): readonly ImageItem[] { return this.orderedItems; }
  get initialOrder(): readonly ImageItem[] { return this.initialItems; }
  get groups(): ImageGroups { return this.groupedItems; }
  get selectedItems(): ImageItem[] { return this.orderedItems.filter(item => item.selected); }
  get hasSelection(): boolean { return this.orderedItems.some(item => item.selected); }

  replace(urls: readonly string[], sourcePage: string): void {
    const groups = groupImages(urls);
    const selectedGroups = defaultSelectedImageGroups(groups);
    const selectedUrls = new Set(Object.entries(groups).flatMap(([key, group]) => selectedGroups[key] ? group.items : []));
    this.orderedItems = urls.map(url => ({url, sourcePage, selected: selectedUrls.has(url)}));
    this.initialItems = [...this.orderedItems];
    this.reindex(groups);
  }

  clear(): void {
    this.orderedItems = [];
    this.initialItems = [];
    this.reindex({});
  }

  itemForUrl(url: string): ImageItem | undefined { return this.itemByUrl.get(url); }
  positionOf(item: ImageItem): number | undefined { return this.positionByItem.get(item); }
  itemsInGroup(key: string): readonly ImageItem[] { return this.itemsByGroup.get(key) ?? []; }
  groupSelection(key: string): {checked: boolean; indeterminate: boolean} {
    const items = this.itemsByGroup.get(key) ?? [];
    const selectedCount = items.filter(item => item.selected).length;
    return {
      checked: items.length > 0 && selectedCount === items.length,
      indeterminate: selectedCount > 0 && selectedCount < items.length,
    };
  }

  visibleItems(groupKey: string | null): ImageItem[] {
    const group = groupKey === null ? null : this.groupedItems[groupKey] ?? null;
    return filterImagesByGroup(this.orderedItems, group);
  }

  setSelected(url: string, selected: boolean): void {
    const item = this.itemByUrl.get(url);
    if (item) item.selected = selected;
  }

  toggleSelected(url: string): void {
    const item = this.itemByUrl.get(url);
    if (item) item.selected = !item.selected;
  }

  setGroupSelected(key: string, selected: boolean): void {
    for (const item of this.itemsByGroup.get(key) ?? []) item.selected = selected;
  }

  setAllSelected(selected: boolean): void {
    for (const item of this.orderedItems) item.selected = selected;
  }

  moveVisible(visibleItems: readonly ImageItem[], source: ImageItem, target: ImageItem): boolean {
    if (source === target) return false;
    const reordered = [...visibleItems];
    const from = reordered.indexOf(source);
    const to = reordered.indexOf(target);
    if (from < 0 || to < 0) return false;
    reordered.splice(from, 1);
    reordered.splice(to, 0, source);
    return this.applyVisibleOrder(visibleItems, reordered);
  }

  /** Replaces visible slots only, leaving filtered-out items at their existing positions. */
  applyVisibleOrder(visibleItems: readonly ImageItem[], reorderedItems: readonly ImageItem[]): boolean {
    if (visibleItems.length !== reorderedItems.length) return false;
    const visibleSet = new Set(visibleItems);
    const reorderedSet = new Set(reorderedItems);
    if (visibleSet.size !== visibleItems.length || reorderedSet.size !== reorderedItems.length ||
        visibleSet.size !== reorderedSet.size || [...visibleSet].some(item => !reorderedSet.has(item)) ||
        [...visibleSet].some(item => !this.positionByItem.has(item))) return false;
    let index = 0;
    this.orderedItems = this.orderedItems.map(item => visibleSet.has(item) ? reorderedItems[index++]! : item);
    this.reindex();
    return true;
  }

  resetOrder(): void {
    this.orderedItems = [...this.initialItems];
    this.reindex();
  }

  matchesInitialOrder(): boolean {
    return this.orderedItems.length === this.initialItems.length &&
      this.orderedItems.every((item, index) => item === this.initialItems[index]);
  }

  private reindex(groups: ImageGroups = groupImages(this.orderedItems.map(item => item.url))): void {
    this.groupedItems = groups;
    this.itemByUrl = new Map(this.orderedItems.map(item => [item.url, item]));
    this.positionByItem = new Map(this.orderedItems.map((item, index) => [item, index]));
    this.itemsByGroup = new Map(Object.entries(groups).map(([key, group]) => [
      key,
      group.items.map(url => this.itemByUrl.get(url)).filter((item): item is ImageItem => item !== undefined),
    ]));
  }
}

import { defaultSelectedImageGroups, filterImagesByGroup, groupMediaImages } from "./images.js";
/** Owns one scan's image identities, selection, grouping, and user-defined order. */
export class ImageCollection {
    orderedItems = [];
    initialItems = [];
    initialSelectedUrls = new Set();
    groupedItems = {};
    itemByUrl = new Map();
    positionByItem = new Map();
    itemsByGroup = new Map();
    get items() { return this.orderedItems; }
    get initialOrder() { return this.initialItems; }
    get groups() { return this.groupedItems; }
    get selectedItems() { return this.orderedItems.filter(item => item.selected); }
    get hasSelection() { return this.orderedItems.some(item => item.selected); }
    replace(urls, sourcePage, media = []) {
        const groups = groupMediaImages(urls, media);
        const selectedGroups = defaultSelectedImageGroups(groups);
        const selectedUrls = new Set(Object.entries(groups).flatMap(([key, group]) => selectedGroups[key] ? group.items : []));
        const metadata = new Map(media.map(item => [item.url, item]));
        this.orderedItems = urls.map(url => {
            const details = metadata.get(url);
            return {
                url,
                sourcePage,
                selected: selectedUrls.has(url),
                ...(details ? { kind: details.kind } : {}),
                ...(details?.previewUrl ? { previewUrl: details.previewUrl } : {}),
            };
        });
        this.initialItems = [...this.orderedItems];
        this.initialSelectedUrls = selectedUrls;
        this.reindex(groups);
    }
    clear() {
        this.orderedItems = [];
        this.initialItems = [];
        this.initialSelectedUrls.clear();
        this.reindex({});
    }
    itemForUrl(url) { return this.itemByUrl.get(url); }
    positionOf(item) { return this.positionByItem.get(item); }
    itemsInGroup(key) { return this.itemsByGroup.get(key) ?? []; }
    groupSelection(key) {
        const items = this.itemsByGroup.get(key) ?? [];
        const selectedCount = items.filter(item => item.selected).length;
        return {
            checked: items.length > 0 && selectedCount === items.length,
            indeterminate: selectedCount > 0 && selectedCount < items.length,
        };
    }
    visibleItems(groupKey) {
        const group = groupKey === null ? null : this.groupedItems[groupKey] ?? null;
        return filterImagesByGroup(this.orderedItems, group);
    }
    setSelected(url, selected) {
        const item = this.itemByUrl.get(url);
        if (item)
            item.selected = selected;
    }
    toggleSelected(url) {
        const item = this.itemByUrl.get(url);
        if (item)
            item.selected = !item.selected;
    }
    setGroupSelected(key, selected) {
        for (const item of this.itemsByGroup.get(key) ?? [])
            item.selected = selected;
    }
    setAllSelected(selected) {
        for (const item of this.orderedItems)
            item.selected = selected;
    }
    moveVisible(visibleItems, source, target) {
        if (source === target)
            return false;
        const reordered = [...visibleItems];
        const from = reordered.indexOf(source);
        const to = reordered.indexOf(target);
        if (from < 0 || to < 0)
            return false;
        reordered.splice(from, 1);
        reordered.splice(to, 0, source);
        return this.applyVisibleOrder(visibleItems, reordered);
    }
    /** Replaces visible slots only, leaving filtered-out items at their existing positions. */
    applyVisibleOrder(visibleItems, reorderedItems) {
        if (visibleItems.length !== reorderedItems.length)
            return false;
        const visibleSet = new Set(visibleItems);
        const reorderedSet = new Set(reorderedItems);
        if (visibleSet.size !== visibleItems.length || reorderedSet.size !== reorderedItems.length ||
            visibleSet.size !== reorderedSet.size || [...visibleSet].some(item => !reorderedSet.has(item)) ||
            [...visibleSet].some(item => !this.positionByItem.has(item)))
            return false;
        let index = 0;
        this.orderedItems = this.orderedItems.map(item => visibleSet.has(item) ? reorderedItems[index++] : item);
        this.reindex();
        return true;
    }
    resetOrder() {
        this.orderedItems = [...this.initialItems];
        this.reindex();
    }
    restoreInitialOrderAndSelection() {
        this.orderedItems = [...this.initialItems];
        for (const item of this.orderedItems)
            item.selected = this.initialSelectedUrls.has(item.url);
        this.reindex();
    }
    matchesInitialOrderAndSelection() {
        return this.matchesInitialOrder() &&
            this.orderedItems.every(item => item.selected === this.initialSelectedUrls.has(item.url));
    }
    matchesInitialOrder() {
        return this.orderedItems.length === this.initialItems.length &&
            this.orderedItems.every((item, index) => item === this.initialItems[index]);
    }
    reindex(groups = groupMediaImages(this.orderedItems.map(item => item.url), this.orderedItems.flatMap(item => item.kind ? [{ url: item.url, kind: item.kind }] : []))) {
        this.groupedItems = groups;
        this.itemByUrl = new Map(this.orderedItems.map(item => [item.url, item]));
        this.positionByItem = new Map(this.orderedItems.map((item, index) => [item, index]));
        this.itemsByGroup = new Map(Object.entries(groups).map(([key, group]) => [
            key,
            group.items.map(url => this.itemByUrl.get(url)).filter((item) => item !== undefined),
        ]));
    }
}

export interface ImageRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface PointerPosition {
  readonly clientX: number;
  readonly clientY: number;
}

/** Chooses the relevant axis from the measured layout and returns whether the pointer is past its midpoint. */
export function isPointerAfter(rect: ImageRect, pointer: PointerPosition, singleColumn: boolean): boolean {
  return singleColumn
    ? pointer.clientY >= rect.top + rect.height / 2
    : pointer.clientX >= rect.left + rect.width / 2;
}

/** Returns a reordered copy, or null when the source or target is not in the supplied order. */
export function createPreviewOrder<T>(order: readonly T[], source: T, target: T, after: boolean): T[] | null {
  if (source === target) return null;
  const sourceIndex = order.indexOf(source);
  const targetIndex = order.indexOf(target);
  if (sourceIndex < 0 || targetIndex < 0) return null;

  const result = order.filter(item => item !== source);
  const insertionIndex = result.indexOf(target);
  if (insertionIndex < 0) return null;
  result.splice(insertionIndex + (after ? 1 : 0), 0, source);
  return result;
}

/** Finds the closest rectangle by squared distance to its outside edge (or zero when inside). */
export function findNearestByRect<T>(
  entries: Iterable<readonly [T, ImageRect]>,
  pointer: PointerPosition,
): T | null {
  let nearest: T | null = null;
  let nearestDistance = Infinity;
  for (const [item, rect] of entries) {
    const dx = Math.max(rect.left - pointer.clientX, 0, pointer.clientX - rect.right);
    const dy = Math.max(rect.top - pointer.clientY, 0, pointer.clientY - rect.bottom);
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearest = item;
      nearestDistance = distance;
    }
  }
  return nearest;
}

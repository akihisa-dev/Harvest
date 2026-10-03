export interface MotionOptions {
  duration?: number;
  easing?: string;
  /** Set false when keyed children keep the same positions and only their state changes. */
  animateLayout?: boolean;
}

const defaultMotion: Required<Pick<MotionOptions, "duration" | "easing">> = {
  duration: 240,
  easing: "cubic-bezier(.22,1,.36,1)",
};

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

const runningMotion = new WeakMap<HTMLElement, Animation>();

function cancelMotion(element: HTMLElement): void {
  runningMotion.get(element)?.cancel();
  runningMotion.delete(element);
}

function startMotion(element: HTMLElement, frames: Keyframe[], options: MotionOptions): void {
  cancelMotion(element);
  const animation = element.animate(frames, {...defaultMotion, ...options});
  runningMotion.set(element, animation);
  const clearFinishedMotion = (): void => {
    if (runningMotion.get(element) === animation) runningMotion.delete(element);
  };
  void animation.finished.then(clearFinishedMotion, clearFinishedMotion);
}

function fadeRemoved(element: HTMLElement, rect: DOMRect, opacity: number, options: MotionOptions): void {
  if (prefersReducedMotion() || typeof element.cloneNode !== "function" || !rect.width || !rect.height) return;
  const ghost = element.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("id");
  ghost.querySelectorAll("[id]").forEach(child => child.removeAttribute("id"));
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  ghost.classList.add("motion-ghost");
  Object.assign(ghost.style, {position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`,
    width: `${rect.width}px`, height: `${rect.height}px`, margin: "0", pointerEvents: "none", zIndex: "10"});
  // Keep selector-dependent thumbnail styling without leaving an interactive row in the list.
  const shell = document.createElement("ol");
  shell.className = "image-list motion-ghost-shell";
  shell.setAttribute("aria-hidden", "true");
  shell.inert = true;
  shell.append(ghost);
  document.body.append(shell);
  const animation = ghost.animate([{opacity}, {opacity: 0}], {...defaultMotion, ...options});
  void animation.finished.then(() => shell.remove(), () => shell.remove());
}

/** Reuses keyed children and animates their layout movement without replaying entry motion. */
export function reconcileKeyedChildren<T, K extends string, E extends HTMLElement = HTMLElement>(
  parent: HTMLElement,
  items: readonly T[],
  keyOf: (item: T) => K,
  create: (item: T) => E,
  update: (element: E, item: T, index: number) => void,
  options: MotionOptions = {},
): Map<K, E> {
  const {animateLayout = true, ...motionOptions} = options;
  const motion = {...defaultMotion, ...motionOptions};
  const before = new Map<K, DOMRect>();
  const opacity = new Map<K, number>();
  const existing = new Map<K, E>();
  for (const child of Array.from(parent.children)) {
    if (!child || typeof (child as HTMLElement).getBoundingClientRect !== "function") continue;
    const element = child as E;
    const key = element.dataset["motionKey"];
    if (key !== undefined) {
      existing.set(key as K, element);
      if (animateLayout) {
        before.set(key as K, element.getBoundingClientRect());
        if (runningMotion.has(element) && typeof getComputedStyle === "function") opacity.set(key as K, Number(getComputedStyle(element).opacity));
        // Measure the current visual position before removing our transform.
        // Leave color/selection CSS transitions running.
        cancelMotion(element);
      }
    }
  }

  const next = new Map<K, E>();
  items.forEach((item, index) => {
    const key = keyOf(item);
    const element = existing.get(key) ?? create(item);
    element.dataset["motionKey"] = key;
    update(element, item, index);
    next.set(key, element);
  });
  for (const [key, element] of existing) {
    if (!next.has(key) && animateLayout) fadeRemoved(element, before.get(key)!, opacity.get(key) ?? 1, motion);
  }
  const nextChildren = [...next.values()];
  const currentChildren = Array.from(parent.children);
  // Keep focus and image layout intact when only selection/text has changed.
  if (currentChildren.length !== nextChildren.length || currentChildren.some((child, index) => child !== nextChildren[index])) {
    parent.replaceChildren(...nextChildren);
  }
  if (!animateLayout || prefersReducedMotion()) return next;
  for (const [key, element] of next) {
    const previous = before.get(key);
    if (!previous) {
      startMotion(element, [{opacity: 0, transform: "translateY(8px)"}, {opacity: 1, transform: "translateY(0)"}], motion);
      continue;
    }
    const current = element.getBoundingClientRect();
    const x = previous.left - current.left;
    const y = previous.top - current.top;
    const fromOpacity = opacity.get(key) ?? 1;
    if (x === 0 && y === 0 && fromOpacity === 1) continue;
    startMotion(element,
      [{opacity: fromOpacity, transform: `translate(${x}px, ${y}px)`}, {opacity: 1, transform: "translate(0, 0)"}],
      {duration: motion.duration, easing: motion.easing},
    );
  }
  return next;
}

/** Retarget a drag preview from the current visual position, including mid-flight changes. */
export function animateLayoutChange(
  elements: readonly HTMLElement[],
  update: () => void,
  skip?: HTMLElement,
): ReadonlyMap<HTMLElement, DOMRect> {
  const before = new Map(elements.map(element => [element, element.getBoundingClientRect()]));
  elements.forEach(cancelMotion);
  update();
  const after = new Map(elements.map(element => [element, element.getBoundingClientRect()]));
  if (prefersReducedMotion()) return after;
  for (const element of elements) {
    if (element === skip) continue;
    const previous = before.get(element)!;
    const current = after.get(element)!;
    const x = previous.left - current.left;
    const y = previous.top - current.top;
    if (x || y) startMotion(element, [{transform: `translate(${x}px, ${y}px)`}, {transform: "translate(0, 0)"}], defaultMotion);
  }
  return after;
}

export function setMotionText(element: HTMLElement, text: string): void {
  if (element.textContent === text) return;
  element.textContent = text;
  if (prefersReducedMotion()) {
    cancelMotion(element);
    return;
  }
  const opacity = runningMotion.has(element) && typeof getComputedStyle === "function"
    ? Number(getComputedStyle(element).opacity) : .65;
  startMotion(element, [{opacity}, {opacity: 1}], defaultMotion);
}

/** Avoid resetting unchanged DOM values (including text-node identity). */
export function setText(element: Node, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}

export function setAttribute(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

export function setHidden(element: HTMLElement, value: boolean): void {
  if (element.hidden !== value) element.hidden = value;
}

export function setClass(element: Element, name: string, value: boolean): void {
  if (element.classList.contains(name) !== value) element.classList.toggle(name, value);
}

/** Avoid resetting unchanged DOM values (including text-node identity). */
export function setText(element, value) {
    if (element.textContent !== value)
        element.textContent = value;
}
export function setAttribute(element, name, value) {
    if (element.getAttribute(name) !== value)
        element.setAttribute(name, value);
}
export function setHidden(element, value) {
    if (element.hidden !== value)
        element.hidden = value;
}
export function setClass(element, name, value) {
    if (element.classList.contains(name) !== value)
        element.classList.toggle(name, value);
}

import { prefersReducedMotion } from "./motion.js";
const labels = new WeakMap();
/** Keep the current label and its outgoing visual layer inside the same button. */
export function setButtonLabel(button, text) {
    // Non-browser consumers still receive the current accessible text immediately.
    if (!button.ownerDocument) {
        button.textContent = text;
        return;
    }
    let label = labels.get(button);
    if (!label) {
        const current = button.ownerDocument.createElement("span");
        const previous = button.ownerDocument.createElement("span");
        current.className = "button-label";
        previous.className = "button-label-previous";
        previous.setAttribute("aria-hidden", "true");
        current.textContent = text;
        button.replaceChildren(previous, current);
        label = { current, previous, animations: [], text };
        labels.set(button, label);
        return;
    }
    if (label.text === text)
        return;
    const style = getComputedStyle(label.current);
    const interrupted = label.animations.some(animation => animation.playState === "running");
    const opacity = Number(style.opacity);
    const transform = style.transform;
    label.animations.forEach(animation => animation.cancel());
    label.previous.dataset["label"] = label.text;
    label.current.textContent = text;
    label.text = text;
    label.animations = [];
    if (prefersReducedMotion())
        return;
    const options = { duration: 180, easing: "cubic-bezier(.22,1,.36,1)" };
    label.animations = [
        label.previous.animate([{ opacity, transform }, { opacity: 0, transform: "translateY(-5px) scale(.94)" }], options),
        label.current.animate([{ opacity: interrupted ? opacity : 0, transform: interrupted ? transform : "translateY(5px) scale(1.04)" }, { opacity: 1, transform: "none" }], options),
    ];
}

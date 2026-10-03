import {prefersReducedMotion} from "./motion.js";

interface ButtonLabel {
  current: HTMLSpanElement;
  previous: HTMLSpanElement;
  animations: Animation[];
  text: string;
}
const labels = new WeakMap<HTMLButtonElement, ButtonLabel>();

/** Keep the current label and its outgoing visual layer inside the same button. */
export function setButtonLabel(button: HTMLButtonElement, text: string): void {
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
    label = {current, previous, animations: [], text};
    labels.set(button, label);
    return;
  }
  const reduced = prefersReducedMotion();
  if (label.text === text && !reduced) return;
  const previousText = label.text;
  label.current.textContent = text;
  label.text = text;
  if (reduced) {
    label.animations.forEach(animation => animation.cancel());
    label.animations = [];
    delete label.previous.dataset["label"];
    return;
  }
  // An incoming label can change immediately without restarting its fade.
  // Keep the visible outgoing layer until the existing transition completes.
  if (label.animations.some(animation => animation.playState === "running" || animation.playState === "paused")) return;
  label.previous.dataset["label"] = previousText;
  const options = {duration: 180, easing: "cubic-bezier(.22,1,.36,1)"};
  const animations = [
    label.previous.animate([{opacity: 1, transform: "none"}, {opacity: 0, transform: "translateY(-5px) scale(.94)"}], options),
    label.current.animate([{opacity: 0, transform: "translateY(5px) scale(1.04)"}, {opacity: 1, transform: "none"}], options),
  ];
  label.animations = animations;
  const activeLabel = label;
  void Promise.all(animations.map(animation => animation.finished)).then(() => {
    if (activeLabel.animations !== animations) return;
    activeLabel.animations = [];
    delete activeLabel.previous.dataset["label"];
  }).catch(() => {});
}

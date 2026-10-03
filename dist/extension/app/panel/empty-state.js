import { prefersReducedMotion } from "./motion.js";
const duration = 220;
function visualStyle(element) {
    if (typeof getComputedStyle === "function") {
        const style = getComputedStyle(element);
        return { opacity: style.opacity, transform: style.transform };
    }
    return { opacity: element.style.opacity || "1", transform: element.style.transform || "none" };
}
function animate(element, frames, complete) {
    if (prefersReducedMotion() || typeof element.animate !== "function") {
        complete?.();
        return null;
    }
    const animation = element.animate(frames, { duration, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "both" });
    void animation.finished.then(() => {
        animation.cancel();
        complete?.();
    }, () => { });
    return animation;
}
/** Keeps empty-state content mounted and retargets its short motion from the current visual state. */
export function createEmptyStateView(elements) {
    const { container, logo, message } = elements;
    const activeText = document.createElement("span");
    activeText.className = "empty-message__visual empty-message__current";
    message.replaceChildren(activeText);
    message.hidden = false;
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    message.setAttribute("aria-atomic", "true");
    let state = null;
    let currentText = "";
    let logoAnimation = null;
    let textAnimation = null;
    const outgoingLayers = [];
    function clearOutgoing() {
        for (const layer of outgoingLayers) {
            layer.animation?.cancel();
            layer.element.remove();
        }
        outgoingLayers.length = 0;
    }
    function clearMotionForReducedPreference() {
        logoAnimation?.cancel();
        logoAnimation = null;
        textAnimation?.cancel();
        textAnimation = null;
        clearOutgoing();
        logo.style.opacity = state === "initial" ? "1" : "0";
        logo.style.transform = `scale(${state === "initial" ? 1 : 0.96})`;
        activeText.style.opacity = currentText ? "1" : "0";
        activeText.style.transform = "none";
    }
    const motionPreference = typeof window === "undefined" ? null : window.matchMedia?.("(prefers-reduced-motion: reduce)");
    motionPreference?.addEventListener?.("change", event => {
        if (event.matches)
            clearMotionForReducedPreference();
    });
    return (nextState, text, announcement) => {
        if (prefersReducedMotion())
            clearMotionForReducedPreference();
        if (state === nextState && currentText === text) {
            message.setAttribute("aria-label", announcement);
            return;
        }
        const previousState = state;
        const previousText = currentText;
        state = nextState;
        currentText = text;
        container.dataset["state"] = nextState;
        message.setAttribute("aria-label", announcement);
        const logoVisible = nextState === "initial";
        logo.setAttribute("aria-hidden", String(!logoVisible));
        const logoVisual = visualStyle(logo);
        const logoFrom = { opacity: logoVisual.opacity, transform: logoVisual.transform === "none" ? "scale(1)" : logoVisual.transform };
        logoAnimation?.cancel();
        logoAnimation = null;
        const logoTo = { opacity: logoVisible ? 1 : 0, transform: `scale(${logoVisible ? 1 : 0.96})` };
        logo.style.opacity = String(logoTo.opacity);
        logo.style.transform = logoTo.transform;
        if (previousState !== null)
            logoAnimation = animate(logo, [logoFrom, logoTo]);
        if (previousText !== text) {
            const oldText = activeText.textContent ?? "";
            const textVisual = visualStyle(activeText);
            const oldVisual = { opacity: textVisual.opacity, transform: textVisual.transform === "none" ? "none" : textVisual.transform };
            textAnimation?.cancel();
            textAnimation = null;
            activeText.textContent = text;
            activeText.style.opacity = text ? "1" : "0";
            activeText.style.transform = "none";
            activeText.setAttribute("aria-hidden", "false");
            if (oldText && !prefersReducedMotion()) {
                while (outgoingLayers.length >= 3) {
                    const oldest = outgoingLayers.shift();
                    oldest.animation?.cancel();
                    oldest.element.remove();
                }
                const outgoing = document.createElement("span");
                outgoing.className = "empty-message__visual empty-message__outgoing";
                outgoing.textContent = oldText;
                outgoing.style.opacity = oldVisual.opacity;
                outgoing.style.transform = oldVisual.transform;
                outgoing.setAttribute("aria-hidden", "true");
                message.append(outgoing);
                const layer = { element: outgoing, animation: null };
                outgoingLayers.push(layer);
                const outgoingAnimation = animate(outgoing, [oldVisual, { opacity: 0, transform: "translateY(-6px)" }], () => {
                    outgoing.remove();
                    const index = outgoingLayers.indexOf(layer);
                    if (index >= 0)
                        outgoingLayers.splice(index, 1);
                });
                layer.animation = outgoingAnimation;
            }
            if (text && !prefersReducedMotion()) {
                textAnimation = animate(activeText, [{ opacity: 0, transform: "translateY(9px) scale(1.02)" }, { opacity: 1, transform: "translateY(0) scale(1)" }]);
            }
            else {
                activeText.setAttribute("aria-hidden", "false");
            }
        }
    };
}

import assert from "node:assert/strict";
import test from "node:test";

class MotionElement {
  constructor(order = 0) {
    this.dataset = {};
    this.style = {order: String(order)};
    this.children = [];
    this.animations = [];
  }
  getBoundingClientRect() {
    const order = Number(this.style.order || 0);
    return {left: 0, top: order * 10, right: 10, bottom: order * 10 + 10};
  }
  getAnimations() { return this.animations; }
  animate(keyframes, options) {
    this.animations.push({keyframes, options, cancel() {}});
    return this.animations.at(-1);
  }
}

class MotionParent extends MotionElement {
  replaceChildren(...children) { this.children = children; }
}

test("選択表示だけの更新では要素を切り離さずフォーカスを保つ", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {matchMedia: () => ({matches: true})};
  try {
    const {reconcileKeyedChildren} = await import("../dist/extension/app/motion.js");
    const parent = new MotionParent();
    let focused = null;
    parent.replaceChildren = (...children) => { focused = null; parent.children = children; };
    const update = (element, item) => { element.selected = item.selected; };
    reconcileKeyedChildren(parent, [{id: "a", selected: true}], item => item.id, () => new MotionElement(), update);
    focused = parent.children[0];
    const original = focused;
    reconcileKeyedChildren(parent, [{id: "a", selected: false}], item => item.id, () => new MotionElement(), update);
    assert.equal(focused, original);
    assert.equal(focused.selected, false);
  } finally { globalThis.window = previousWindow; }
});

test("キー付き要素を再利用し、並び替えだけを滑らかに動かす", async () => {
  globalThis.window = {matchMedia: () => ({matches: false})};
  const {reconcileKeyedChildren} = await import("../dist/extension/app/motion.js?test=" + Date.now());
  const parent = new MotionParent();
  const first = reconcileKeyedChildren(parent, [{id: "a"}, {id: "b"}], item => item.id, () => new MotionElement(), (element, _item, index) => { element.style.order = String(index); });
  const a = first.get("a");
  const b = first.get("b");
  const second = reconcileKeyedChildren(parent, [{id: "b"}, {id: "a"}], item => item.id, () => new MotionElement(), (element, _item, index) => { element.style.order = String(index); });
  assert.strictEqual(second.get("a"), a);
  assert.strictEqual(second.get("b"), b);
  assert.ok(a.animations.length >= 1);
  assert.equal(a.animations.at(-1).options.duration, 240);
});

test("reduced motionでは位置アニメーションを発生させない", async () => {
  globalThis.window = {matchMedia: () => ({matches: true})};
  const {reconcileKeyedChildren} = await import("../dist/extension/app/motion.js?reduced=" + Date.now());
  const parent = new MotionParent();
  reconcileKeyedChildren(parent, [{id: "a"}], item => item.id, () => new MotionElement(), (element, _item, index) => { element.style.order = String(index); });
  const element = parent.children[0];
  reconcileKeyedChildren(parent, [{id: "a"}], item => item.id, () => new MotionElement(), (current, _item, index) => { current.style.order = String(index); });
  assert.equal(element.animations.length, 0);
});

test("移動途中の再操作は現在の見た目から開始し、色の切替を取り消さない", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {matchMedia: () => ({matches: false})};
  try {
    const {animateLayoutChange} = await import("../dist/extension/app/motion.js?interrupt=" + Date.now());
    const element = new MotionElement();
    let visualOffset = 0;
    let cancelled = false;
    element.getBoundingClientRect = () => ({left: 0, top: Number(element.style.order) * 10 + visualOffset});
    element.animate = (keyframes, options) => {
      const animation = {keyframes, options, cancel() { cancelled = true; visualOffset = 0; }};
      element.animations.push(animation);
      return animation;
    };
    // CSS transitions must remain untouched by layout animation cancellation.
    element.getAnimations = () => { throw new Error("Unrelated animations must not be cancelled"); };
    animateLayoutChange([element], () => { element.style.order = "1"; });
    visualOffset = -5;
    animateLayoutChange([element], () => { element.style.order = "2"; });
    assert.equal(cancelled, true);
    assert.equal(element.animations.at(-1).keyframes[0].transform, "translate(0px, -15px)");
    globalThis.window = {matchMedia: () => ({matches: true})};
    animateLayoutChange([element], () => { element.style.order = "0"; });
    assert.equal(element.animations.length, 2);
    assert.equal(visualOffset, 0);
  } finally { globalThis.window = previousWindow; }
});

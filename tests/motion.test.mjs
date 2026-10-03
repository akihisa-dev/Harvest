import assert from "node:assert/strict";
import test from "node:test";

class MotionElement {
  constructor(order = 0) {
    this.dataset = {};
    this.style = {order: String(order)};
    this.children = [];
    this.animations = [];
    this.rectReads = 0;
  }
  getBoundingClientRect() {
    this.rectReads++;
    const order = Number(this.style.order || 0);
    return {left: 0, top: order * 10, right: 10, bottom: order * 10 + 10};
  }
  getAnimations() { return this.animations; }
  animate(keyframes, options) {
    this.animations.push({keyframes, options, finished: new Promise(() => {}), cancel() {} });
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
    parent.replaceChildren = (...children) => {
      focused = null;
      parent.children = children;
    };
    const update = (element, item) => { element.selected = item.selected; };
    reconcileKeyedChildren(parent, [{id: "a", selected: true}], item => item.id, () => new MotionElement(), update);
    focused = parent.children[0];
    const original = focused;
    reconcileKeyedChildren(parent, [{id: "a", selected: false}], item => item.id, () => new MotionElement(), update);
    assert.equal(focused, original);
    assert.equal(focused.selected, false);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("大量行の選択状態更新では位置計測を行わない", async () => {
  globalThis.window = {matchMedia: () => ({matches: false})};
  const {reconcileKeyedChildren} = await import("../dist/extension/app/motion.js?selection=" + Date.now());
  const parent = new MotionParent();
  const items = Array.from({length: 500}, (_, index) => ({id: String(index), selected: true}));
  const update = (element, item) => { element.selected = item.selected; };
  const first = reconcileKeyedChildren(parent, items, item => item.id, () => new MotionElement(), update);
  const rows = [...first.values()];
  rows.forEach(row => { row.rectReads = 0; });
  reconcileKeyedChildren(parent, items.map((item, index) => ({...item, selected: index !== 0})), item => item.id,
    () => new MotionElement(), update, {animateLayout: false});
  assert.equal(rows.reduce((sum, row) => sum + row.rectReads, 0), 0);
  assert.equal(parent.children.length, 500);
  assert.equal(parent.children[0], rows[0]);
  assert.equal(rows[0].selected, false);
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
      const animation = {
        keyframes, options, finished: new Promise(() => {}), cancel() {
          cancelled = true;
          visualOffset = 0;
        }
      };
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
  } finally {
    globalThis.window = previousWindow;
  }
});


test("ステータス文字は完了後もフェードし、古い完了通知は新しい動きを消さない", async () => {
  const previousWindow = globalThis.window;
  const previousStyle = globalThis.getComputedStyle;
  globalThis.window = {matchMedia: () => ({matches: false})};
  globalThis.getComputedStyle = () => ({opacity: "0.8"});
  try {
    const {setMotionText} = await import("../dist/extension/app/motion.js?text=" + Date.now());
    const element = new MotionElement();
    element.animate = (keyframes, options) => {
      let finish, reject;
      const finished = new Promise((resolve, fail) => {
        finish = resolve;
        reject = fail;
      });
      const animation = {keyframes, options, finished, finish, reject, cancel() {} };
      element.animations.push(animation);
      return animation;
    };
    setMotionText(element, "first");
    assert.equal(element.animations.at(-1).keyframes[0].opacity, .65);
    element.animations.at(-1).finish();
    await Promise.resolve();
    setMotionText(element, "second");
    assert.equal(element.animations.at(-1).keyframes[0].opacity, .65, "completed fades start a fresh visible fade");
    const second = element.animations.at(-1);
    setMotionText(element, "third");
    assert.equal(element.animations.at(-1).keyframes[0].opacity, .8, "interrupted fades use the current opacity");
    second.reject(new Error("cancelled"));
    await Promise.resolve();
    setMotionText(element, "fourth");
    assert.equal(element.animations.at(-1).keyframes[0].opacity, .8, "old rejection does not clear the current motion");
    element.animations.at(-1).reject(new Error("cancelled"));
    await Promise.resolve();
    setMotionText(element, "fifth");
    assert.equal(element.animations.at(-1).keyframes[0].opacity, .65, "rejected current motions are cleaned up too");
    globalThis.window = {matchMedia: () => ({matches: true})};
    const count = element.animations.length;
    setMotionText(element, "reduced");
    assert.equal(element.textContent, "reduced");
    assert.equal(element.animations.length, count);
  } finally {
    globalThis.window = previousWindow;
    globalThis.getComputedStyle = previousStyle;
  }
});

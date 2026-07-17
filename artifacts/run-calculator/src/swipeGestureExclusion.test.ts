// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { isSwipeExcludedTarget } from "./swipeGesture";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("isSwipeExcludedTarget", () => {
  it("excludes form controls, buttons, and links (including nested targets)", () => {
    document.body.innerHTML = `
      <input id="inp" />
      <textarea id="ta"></textarea>
      <select id="sel"><option>a</option></select>
      <button id="btn"><span id="btn-inner">Go</span></button>
      <a id="link" href="#"><span id="link-inner">x</span></a>
      <div role="slider" id="slider"><span id="slider-inner"></span></div>
    `;
    for (const id of ["inp", "ta", "sel", "btn", "btn-inner", "link", "link-inner", "slider", "slider-inner"]) {
      expect(isSwipeExcludedTarget(document.getElementById(id)), id).toBe(true);
    }
  });

  it("excludes data-no-swipe regions", () => {
    document.body.innerHTML = `<div data-no-swipe><p id="p">text</p></div>`;
    expect(isSwipeExcludedTarget(document.getElementById("p"))).toBe(true);
  });

  it("does not exclude plain content", () => {
    document.body.innerHTML = `<div><p id="p">just text</p></div>`;
    expect(isSwipeExcludedTarget(document.getElementById("p"))).toBe(false);
  });

  it("handles null and non-element targets", () => {
    expect(isSwipeExcludedTarget(null)).toBe(false);
    expect(isSwipeExcludedTarget(document.createTextNode("t") as unknown as EventTarget)).toBe(false);
  });

  it("excludes targets inside a horizontally scrollable ancestor", () => {
    document.body.innerHTML = `<div id="scroller" style="overflow-x: auto"><span id="child">wide</span></div>`;
    const scroller = document.getElementById("scroller") as HTMLElement;
    // jsdom has no layout: fake overflowing content metrics
    Object.defineProperty(scroller, "scrollWidth", { value: 500 });
    Object.defineProperty(scroller, "clientWidth", { value: 200 });
    expect(isSwipeExcludedTarget(document.getElementById("child"))).toBe(true);
  });

  it("does not exclude a wide element whose overflow-x is not scrollable", () => {
    document.body.innerHTML = `<div id="wide" style="overflow-x: visible"><span id="child">wide</span></div>`;
    const wide = document.getElementById("wide") as HTMLElement;
    Object.defineProperty(wide, "scrollWidth", { value: 500 });
    Object.defineProperty(wide, "clientWidth", { value: 200 });
    expect(isSwipeExcludedTarget(document.getElementById("child"))).toBe(false);
  });
});

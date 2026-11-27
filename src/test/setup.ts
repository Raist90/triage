import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach } from "bun:test";

// Register the DOM before Testing Library is loaded so its `document` checks
// see happy-dom rather than a bare Bun global.
GlobalRegistrator.register();

// React 19 reads this flag to decide whether act() warnings are errors.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom does not implement layout, but components call this on keyboard
// navigation and after jumps. A no-op keeps those paths renderable.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const { cleanup } = await import("@testing-library/react");
afterEach(() => cleanup());

// happy-dom has no layout, so its IntersectionObserver reports every observed
// node asynchronously and outside act(). Remove the API so the diff takes its
// documented eager fallback: lazy body mounting is viewport behavior, exercised
// in the app, not in layout-less unit tests.
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
  undefined;

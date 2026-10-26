import { afterEach, expect, it, vi } from "vite-plus/test";
import { observeReviewActivation } from "../client/review-activation";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fixture() {
  vi.useFakeTimers();
  let resize: ResizeObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  const document = new EventTarget();
  const root = { ownerDocument: document, contains: () => false } as unknown as HTMLElement;
  const activate = vi.fn();
  const stop = observeReviewActivation(root, activate);
  cleanups.push(stop);
  return {
    activate,
    disconnect,
    stop,
    resize(visible: boolean) {
      resize(
        [
          { contentRect: { width: visible ? 800 : 0, height: visible ? 600 : 0 } },
        ] as ResizeObserverEntry[],
        {} as ResizeObserver,
      );
    },
    event(type: string, inside: boolean, action?: () => void) {
      const event = new Event(type);
      // A composed path includes the panel even for controls inside a shadow root.
      event.composedPath = () => (inside ? [new EventTarget(), root, document] : [document]);
      document.dispatchEvent(event);
      action?.();
    },
  };
}

it("refreshes when returning to a visible split by pointer, after the clicked action finishes", () => {
  const panel = fixture();
  panel.resize(true);
  vi.runAllTimers();
  expect(panel.activate).not.toHaveBeenCalled();
  panel.event("pointerdown", false);
  panel.event("focusin", false);
  panel.event("pointerdown", true);
  panel.event("focusin", true);
  vi.runAllTimers();
  expect(panel.activate).not.toHaveBeenCalled();
  let draft = false;
  panel.activate.mockImplementation(() => expect(draft).toBe(true));
  panel.event("click", true, () => {
    draft = true;
  });
  expect(panel.activate).not.toHaveBeenCalled();
  vi.runAllTimers();
  expect(panel.activate).toHaveBeenCalledOnce();
  panel.event("pointerdown", true);
  panel.event("click", true);
  panel.event("focusin", true);
  panel.resize(true);
  vi.runAllTimers();
  expect(panel.activate).toHaveBeenCalledOnce();
  panel.event("pointerdown", false);
  panel.event("pointerdown", true);
  panel.event("click", true);
  vi.runAllTimers();
  expect(panel.activate).toHaveBeenCalledTimes(2);
});

it("refreshes on keyboard entry but not when focus moves between controls in the review", () => {
  const panel = fixture();
  panel.resize(true);
  panel.event("focusin", true);
  vi.runAllTimers();
  expect(panel.activate).toHaveBeenCalledOnce();
  panel.event("focusin", true);
  vi.runAllTimers();
  expect(panel.activate).toHaveBeenCalledOnce();
  panel.event("focusin", false);
  panel.event("focusin", true);
  vi.runAllTimers();
  expect(panel.activate).toHaveBeenCalledTimes(2);
});

it("keeps hidden-tab returns, ignores ordinary resizing and avoids duplicate click refreshes", () => {
  const panel = fixture();
  panel.resize(true);
  panel.resize(true);
  vi.runAllTimers();
  expect(panel.activate).not.toHaveBeenCalled();
  panel.resize(false);
  panel.resize(true);
  panel.event("pointerdown", true);
  panel.event("focusin", true);
  panel.event("click", true);
  vi.runAllTimers();
  expect(panel.activate).toHaveBeenCalledOnce();
});

it("cancels pending activation when leaving or disposing and removes its listeners", () => {
  const panel = fixture();
  panel.resize(true);
  panel.event("focusin", true);
  panel.event("focusin", false);
  vi.runAllTimers();
  expect(panel.activate).not.toHaveBeenCalled();
  panel.event("focusin", true);
  panel.resize(false);
  vi.runAllTimers();
  expect(panel.activate).not.toHaveBeenCalled();
  panel.resize(true);
  panel.stop();
  vi.runAllTimers();
  panel.event("pointerdown", false);
  panel.event("focusin", true);
  panel.event("click", true);
  vi.runAllTimers();
  expect(panel.activate).not.toHaveBeenCalled();
  expect(panel.disconnect).toHaveBeenCalled();
});

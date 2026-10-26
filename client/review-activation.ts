/** Observe panel returns without depending on the host's split layout internals. */
export function observeReviewActivation(root: HTMLElement, activate: () => void): () => void {
  const document = root.ownerDocument;
  let visible: boolean | undefined;
  let active = root.contains(document.activeElement);
  let pointerReturn = false;
  let pending: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    if (pending !== undefined) return;
    // Let the click finish first: Edit must create its draft before refresh checks its guard.
    pending = setTimeout(() => {
      pending = undefined;
      if (visible && active) activate();
    }, 0);
  };
  const inside = (event: Event) => event.composedPath().includes(root);
  const pointerDown = (event: Event) => {
    const next = inside(event);
    pointerReturn = next && !active;
    active = next;
  };
  const click = (event: Event) => {
    if (pointerReturn && inside(event)) schedule();
    pointerReturn = false;
  };
  const focusIn = (event: Event) => {
    const next = inside(event);
    if (next && !active) schedule();
    active = next;
  };
  const visibility = new ResizeObserver(([entry]) => {
    const next = entry !== undefined && entry.contentRect.width > 0 && entry.contentRect.height > 0;
    const returning = next && visible === false;
    visible = next;
    if (!next) {
      active = false;
      pointerReturn = false;
    } else if (returning) {
      active = true;
      schedule();
    }
  });
  // Capture also sees events from controls that stop propagation and Pierre shadow roots.
  document.addEventListener("pointerdown", pointerDown, true);
  document.addEventListener("click", click, true);
  document.addEventListener("focusin", focusIn, true);
  visibility.observe(root);

  return () => {
    visibility.disconnect();
    document.removeEventListener("pointerdown", pointerDown, true);
    document.removeEventListener("click", click, true);
    document.removeEventListener("focusin", focusIn, true);
    if (pending !== undefined) clearTimeout(pending);
  };
}

/** Selection uses content coordinates so scrolling does not move the anchor. */
export function beginExplorerMarquee({
  owner,
  pointer,
  initial,
  additive,
  selection,
  focus,
}: {
  owner: HTMLElement;
  pointer: PointerEvent;
  initial: string[];
  additive: boolean;
  selection: (ids: string[]) => void;
  focus: HTMLElement;
}) {
  const start = { x: pointer.clientX, y: pointer.clientY + owner.scrollTop },
    previous = [...initial];
  let current = { x: pointer.clientX, y: pointer.clientY },
    active = false,
    ended = false,
    frame = 0;
  const box = document.createElement("div");
  box.className = "explorer-selection-rectangle";
  box.hidden = true;
  document.body.append(box);
  const base = additive ? initial : [];
  const render = () => {
    if (!active) return;
    const r = owner.getBoundingClientRect(),
      sx = start.x,
      sy = start.y - owner.scrollTop,
      left = Math.min(sx, current.x),
      right = Math.max(sx, current.x),
      top = Math.max(r.top, Math.min(sy, current.y)),
      bottom = Math.min(r.bottom, Math.max(sy, current.y));
    Object.assign(box.style, {
      left: left + "px",
      top: top + "px",
      width: right - left + "px",
      height: Math.max(0, bottom - top) + "px",
    });
    box.hidden = false;
    const contentTop = Math.min(start.y, current.y + owner.scrollTop),
      contentBottom = Math.max(start.y, current.y + owner.scrollTop);
    const ids = [...owner.querySelectorAll<HTMLElement>("[data-resource-id]")]
      .filter((row) => {
        const b = row.getBoundingClientRect();
        return (
          b.right >= left &&
          b.left <= right &&
          b.bottom + owner.scrollTop >= contentTop &&
          b.top + owner.scrollTop <= contentBottom
        );
      })
      .map((row) => row.dataset.resourceId!);
    selection([...new Set([...base, ...ids])]);
  };
  const tick = () => {
    if (ended) return;
    if (active) {
      const r = owner.getBoundingClientRect();
      const delta =
        current.y < r.top + 44
          ? -Math.min(18, (r.top + 44 - current.y) / 3)
          : current.y > r.bottom - 44
            ? Math.min(18, (current.y - r.bottom + 44) / 3)
            : 0;
      if (delta) {
        owner.scrollTop += delta;
        render();
      }
    }
    frame = requestAnimationFrame(tick);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointer.pointerId) return;
    current = { x: e.clientX, y: e.clientY };
    if (
      !active &&
      Math.hypot(e.clientX - start.x, e.clientY + owner.scrollTop - start.y) >=
        5
    ) {
      active = true;
      owner.setPointerCapture(e.pointerId);
      focus.focus({ preventScroll: true });
    }
    render();
  };
  const done = (cancel = false) => {
    if (ended) return;
    ended = true;
    if (cancel) selection(previous);
    else if (!active) {
      selection(base);
      focus.focus({ preventScroll: true });
    }
    box.remove();
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", canceled);
    window.removeEventListener("keydown", key);
    window.removeEventListener("blur", canceled);
    owner.removeEventListener("lostpointercapture", canceled);
    if (owner.hasPointerCapture(pointer.pointerId))
      owner.releasePointerCapture(pointer.pointerId);
  };
  const up = (e: PointerEvent) => {
      if (e.pointerId === pointer.pointerId) done();
    },
    canceled = () => done(true),
    key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        done(true);
      }
    };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", canceled);
  window.addEventListener("keydown", key);
  window.addEventListener("blur", canceled);
  owner.addEventListener("lostpointercapture", canceled);
  frame = requestAnimationFrame(tick);
  return canceled;
}

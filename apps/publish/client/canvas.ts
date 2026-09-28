export function initializeCanvas(view: HTMLElement) {
  const world = view.querySelector<HTMLElement>(".canvas-public-world")!;
  const toolbar = view.previousElementSibling!;
  const bounds = JSON.parse(world.dataset.bounds ?? "{}");
  let scale = 1,
    x = 0,
    y = 0;
  const paint = () => {
    world.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
  };
  const fit = () => {
    scale = Math.min(
      1,
      (view.clientWidth - 64) / Math.max(1, bounds.width),
      (view.clientHeight - 64) / Math.max(1, bounds.height),
    );
    x = (view.clientWidth - bounds.width * scale) / 2 - bounds.x * scale;
    y = (view.clientHeight - bounds.height * scale) / 2 - bounds.y * scale;
    paint();
  };
  const zoom = (factor: number) => {
    const next = Math.max(0.08, Math.min(4, scale * factor)),
      ratio = next / scale;
    x = view.clientWidth / 2 - (view.clientWidth / 2 - x) * ratio;
    y = view.clientHeight / 2 - (view.clientHeight / 2 - y) * ratio;
    scale = next;
    paint();
  };
  toolbar
    .querySelectorAll<HTMLElement>("[data-canvas-zoom]")
    .forEach((el) =>
      el.addEventListener("click", () =>
        el.dataset.canvasZoom === "fit"
          ? fit()
          : zoom(el.dataset.canvasZoom === "in" ? 1.25 : 0.8),
      ),
    );
  view.addEventListener("pointerdown", (e) => {
    if (
      e.button ||
      (e.target as Element).closest("a,button,input,.canvas-public-card")
    )
      return;
    view.setPointerCapture(e.pointerId);
    let lastX = e.clientX,
      lastY = e.clientY;
    const move = (event: PointerEvent) => {
      x += event.clientX - lastX;
      y += event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      paint();
    };
    const end = () => {
      view.removeEventListener("pointermove", move);
      view.removeEventListener("pointerup", end);
      view.removeEventListener("pointercancel", end);
    };
    view.addEventListener("pointermove", move);
    view.addEventListener("pointerup", end);
    view.addEventListener("pointercancel", end);
  });
  view.addEventListener("keydown", (e) => {
    if (e.target !== view) return;
    if (
      [
        "+",
        "=",
        "-",
        "0",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
      ].includes(e.key)
    )
      e.preventDefault();
    if (e.key === "+" || e.key === "=") zoom(1.25);
    if (e.key === "-") zoom(0.8);
    if (e.key === "0") fit();
    if (e.key === "ArrowLeft") x += 60;
    if (e.key === "ArrowRight") x -= 60;
    if (e.key === "ArrowUp") y += 60;
    if (e.key === "ArrowDown") y -= 60;
    paint();
  });
  toolbar
    .querySelector<HTMLInputElement>("[data-canvas-search]")
    ?.addEventListener("input", (e) => {
      const q = (e.target as HTMLInputElement).value.toLowerCase();
      const cards = [
        ...world.querySelectorAll<HTMLElement>(".canvas-public-card"),
      ];
      cards.forEach((c) =>
        c.classList.toggle(
          "search-match",
          !!q && (c.textContent ?? "").toLowerCase().includes(q),
        ),
      );
      const match = cards.find((c) => c.classList.contains("search-match"));
      if (match) {
        x =
          view.clientWidth / 2 -
          (parseFloat(match.style.left) + match.offsetWidth / 2) * scale;
        y =
          view.clientHeight / 2 -
          (parseFloat(match.style.top) + match.offsetHeight / 2) * scale;
        paint();
      }
    });
  fit();
}

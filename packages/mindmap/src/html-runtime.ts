/** Fixed first-party code only. No user-provided expressions or metadata execute. */
export const mindmapHtmlScript = String.raw`(() => {
  const svg = document.querySelector('svg');
  const initial = svg.getAttribute('viewBox').split(/\s+/).map(Number);
  let box = initial.slice(), drag = null;
  const nodes = [...svg.querySelectorAll('[data-node]')];
  const edges = [...svg.querySelectorAll('[data-edge]')];
  const folds = new Set();
  const children = new Map();
  for (const node of nodes) {
    const items = children.get(node.dataset.parent) || [];
    items.push(node.dataset.node); children.set(node.dataset.parent, items);
  }
  const paint = () => svg.setAttribute('viewBox', box.join(' '));
  const refresh = () => {
    const hidden = new Set(), queue = [...folds];
    for (let index = 0; index < queue.length; index++) {
      for (const child of children.get(queue[index]) || []) {
        if (!hidden.has(child)) { hidden.add(child); queue.push(child); }
      }
    }
    for (const node of nodes) {
      node.style.display = hidden.has(node.dataset.node) ? 'none' : '';
      node.setAttribute('aria-expanded', String(!folds.has(node.dataset.node)));
    }
    for (const edge of edges) edge.style.display = hidden.has(edge.dataset.edge) ? 'none' : '';
  };
  const zoom = factor => {
    const width = box[2] * factor;
    if (width < initial[2] / 20 || width > initial[2] * 20) return;
    box = [box[0] + box[2] * (1-factor)/2, box[1] + box[3] * (1-factor)/2, width, box[3]*factor];
    paint();
  };
  document.getElementById('fit').onclick = () => { box = initial.slice(); paint(); };
  document.getElementById('in').onclick = () => zoom(.8);
  document.getElementById('out').onclick = () => zoom(1.25);
  document.getElementById('expand').onclick = () => { folds.clear(); refresh(); };
  for (const node of nodes) {
    const toggle = () => { folds.has(node.dataset.node) ? folds.delete(node.dataset.node) : folds.add(node.dataset.node); refresh(); };
    node.onclick = () => {
      if (!drag?.moved && !(typeof getSelection === 'function' && getSelection()?.type === 'Range')) toggle();
    };
    node.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } };
  }
  svg.onwheel = event => { event.preventDefault(); zoom(event.deltaY > 0 ? 1.1 : .9); };
  svg.onpointerdown = event => {
    if (event.button !== 0) return;
    if (event.target?.closest?.('text')) return;
    drag = { x: event.clientX, y: event.clientY, box: box.slice(), moved: false };
    // Preserve node clicks: capture only after the drag threshold is crossed.
  };
  svg.onpointermove = event => {
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.hypot(dx,dy) <= 4 && !drag.moved) return;
    drag.moved = true;
    if (!svg.hasPointerCapture(event.pointerId)) svg.setPointerCapture(event.pointerId);
    const rect = svg.getBoundingClientRect();
    box = [drag.box[0] - dx*drag.box[2]/rect.width, drag.box[1] - dy*drag.box[3]/rect.height, drag.box[2], drag.box[3]];
    paint();
  };
  svg.onpointerup = event => {
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    setTimeout(() => drag = null, 0);
  };
  svg.onpointercancel = () => drag = null;
  refresh();
})()`;

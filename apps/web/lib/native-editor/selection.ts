import { decodeHTMLStrict } from "entities";
import type { SourceSelection } from "./transactions";

export type TextMapping = {
  text: Text;
  from: number;
  to: number;
  offsets: number[];
  shift?: number;
};

/** Raw Markdown is UTF-16 source, not decoded display text. */
export function sourceOffsets(value: string, from: number) {
  return Array.from({ length: value.length + 1 }, (_, index) => from + index);
}
export type MappedBlock = {
  element: HTMLElement;
  from: number;
  to: number;
  raw: string;
  signature: string;
  maps: TextMapping[];
};

/** Patch a changed block without destroying focused controls or unchanged math SVGs. */
export function reconcileBlock(previous: MappedBlock, next: MappedBlock) {
  const diagnostic =
    previous.raw === next.raw
      ? previous.element
          .querySelector(".native-math-diagnostic")
          ?.cloneNode(true)
      : null;
  const mappings = new Map(
    next.maps.map((mapping) => [mapping.text as Node, mapping]),
  );
  const reconcile = (old: Node, fresh: Node): Node => {
    if (
      old.nodeType !== fresh.nodeType ||
      (old instanceof Element &&
        fresh instanceof Element &&
        old.tagName !== fresh.tagName)
    )
      return fresh;
    if (old instanceof Text && fresh instanceof Text) {
      const mapping = mappings.get(fresh);
      if (mapping) mapping.text = old;
      if (old.data !== fresh.data) old.data = fresh.data;
      return old;
    }
    if (!(old instanceof HTMLElement) || !(fresh instanceof HTMLElement))
      return fresh;
    if (
      old.hasAttribute("data-math-request") &&
      old.getAttribute("data-math-request") ===
        fresh.getAttribute("data-math-request")
    )
      return old;
    for (const attribute of Array.from(old.attributes))
      if (!fresh.hasAttribute(attribute.name))
        old.removeAttribute(attribute.name);
    for (const attribute of Array.from(fresh.attributes))
      if (old.getAttribute(attribute.name) !== attribute.value)
        old.setAttribute(attribute.name, attribute.value);
    if (old instanceof HTMLInputElement && fresh instanceof HTMLInputElement) {
      old.checked = fresh.checked;
      old.disabled = fresh.disabled;
      if (old !== document.activeElement) old.value = fresh.value;
    }
    const freshChildren = Array.from(fresh.childNodes),
      oldChildren = Array.from(old.childNodes);
    for (let i = 0; i < freshChildren.length; i++) {
      const child = oldChildren[i]
        ? reconcile(oldChildren[i], freshChildren[i])
        : freshChildren[i];
      if (oldChildren[i]) {
        if (child !== oldChildren[i]) old.replaceChild(child, oldChildren[i]);
      } else old.appendChild(child);
    }
    for (let i = freshChildren.length; i < oldChildren.length; i++)
      oldChildren[i].remove();
    return old;
  };
  next.element = reconcile(previous.element, next.element) as HTMLElement;
  if (diagnostic && !next.element.querySelector(".native-math-diagnostic"))
    next.element.append(diagnostic);
  return next;
}

/** The parser keeps source spans; this maps decoded display characters inside a leaf. */
export function displayOffsets(display: string, raw: string, from: number) {
  if (display === raw) return sourceOffsets(display, from);
  const offsets: number[] = [];
  let at = 0;
  for (let i = 0; i < display.length;) {
    if (raw[at] === "\\" && raw[at + 1] === display[i]) at++;
    const entity =
      raw[at] === "&"
        ? /^&(?:#[xX][\da-fA-F]+|#\d+|\w+);/.exec(raw.slice(at))
        : null;
    const decoded = entity ? decodeHTMLStrict(entity[0]) : "";
    if (entity && decoded && display.startsWith(decoded, i)) {
      for (let n = 0; n < decoded.length; n++) offsets.push(from + at);
      at += entity[0].length;
      i += decoded.length;
    } else {
      // Container prefixes are absent from inline display text on subsequent lines.
      if (raw[at] !== display[i]) {
        const match = raw.indexOf(display[i], at);
        if (match >= 0) at = match;
      }
      offsets.push(from + at);
      at = Math.min(raw.length, at + 1);
      i++;
    }
  }
  offsets.push(from + at);
  return offsets;
}

export class SourceDOMMap {
  maps: TextMapping[] = [];
  private byNode = new WeakMap<Node, TextMapping>();
  constructor(readonly root: HTMLElement) {}
  reset(maps: TextMapping[]) {
    this.maps = maps;
    this.byNode = new WeakMap();
    for (const m of maps) this.byNode.set(m.text, m);
  }
  sourcePosition(node: Node, offset: number, end = false): number | null {
    const mapped = this.byNode.get(node);
    if (mapped)
      return (
        (mapped.shift ?? 0) +
        mapped.offsets[Math.max(0, Math.min(mapped.offsets.length - 1, offset))]
      );
    if (node.nodeType === Node.ELEMENT_NODE) {
      const children = node.childNodes;
      // Element boundaries can sit after noneditable grips/toolbars. Skip those
      // siblings instead of collapsing an entire selected cell to its start.
      for (let index = offset; index < children.length; index++) {
        const child = children[index],
          m = this.maps.find((m) => child === m.text || child.contains(m.text));
        if (m) return m.from;
      }
      for (
        let index = Math.min(offset - 1, children.length - 1);
        index >= 0;
        index--
      ) {
        const child = children[index],
          contained = this.maps.filter(
            (m) => child === m.text || child.contains(m.text),
          ),
          m = contained.at(-1);
        if (m) return m.to;
      }
      const el = (node as Element).closest<HTMLElement>("[data-nfrom]");
      if (el)
        return Number(end || offset > 0 ? el.dataset.nto : el.dataset.nfrom);
    }
    const parent = node.parentElement?.closest<HTMLElement>("[data-nfrom]");
    return parent
      ? Number(end ? parent.dataset.nto : parent.dataset.nfrom)
      : null;
  }
  read(): SourceSelection | null {
    const s = this.root.ownerDocument.getSelection();
    if (
      !s?.anchorNode ||
      !s.focusNode ||
      !this.root.contains(s.anchorNode) ||
      !this.root.contains(s.focusNode)
    )
      return null;
    const anchor = this.sourcePosition(s.anchorNode, s.anchorOffset),
      head = this.sourcePosition(s.focusNode, s.focusOffset);
    return anchor === null || head === null ? null : { anchor, head };
  }
  domPosition(
    position: number,
    approximate = false,
  ): { node: Text; offset: number } | null {
    let closest: TextMapping | undefined,
      boundary: TextMapping | undefined,
      distance = Infinity;
    for (const m of this.maps) {
      if (!m.text.isConnected) continue;
      // Prefer the start of the next line over the preceding line's end.
      // A DOM range starting after a block-level source line otherwise gains
      // browser-inserted line breaks absent from the canonical selection.
      if (
        position === m.to &&
        position !== m.from &&
        m.offsets.at(-1)! + (m.shift ?? 0) === position
      ) {
        // A paragraph-end caret belongs to its text, not the following gap.
        // Ending a DOM range at the next <p> would add browser paragraph breaks
        // even when the canonical source selection excludes those newlines.
        if (!m.text.data.endsWith("\n"))
          return { node: m.text, offset: m.text.length };
        boundary = m;
        continue;
      }
      if ((position >= m.from && position < m.to) || position === m.from) {
        const offset = m.offsets.findIndex(
          (p) => p + (m.shift ?? 0) === position,
        );
        if (offset >= 0)
          return { node: m.text, offset: Math.min(m.text.length, offset) };
      }
      const d = Math.min(
        Math.abs(m.from - position),
        Math.abs(m.to - position),
      );
      if (d < distance) {
        closest = m;
        distance = d;
      }
    }
    if (boundary) return { node: boundary.text, offset: boundary.text.length };
    return approximate && closest
      ? {
          node: closest.text,
          offset: position < closest.from ? 0 : closest.text.length,
        }
      : null;
  }
  restore(selection: SourceSelection) {
    const a = this.domPosition(selection.anchor),
      b = this.domPosition(selection.head);
    if (!a || !b) return false;
    this.root.ownerDocument
      .getSelection()
      ?.setBaseAndExtent(a.node, a.offset, b.node, b.offset);
    return true;
  }
  rect(position: number) {
    const p = this.domPosition(position, true);
    if (!p) return null;
    const range = document.createRange();
    range.setStart(p.node, p.offset);
    range.collapse(true);
    const box = range.getClientRects()[0];
    if (box?.height) return box;
    return p.node.parentElement?.getBoundingClientRect() ?? null;
  }
  rangeRects(from: number, to: number) {
    const a = this.domPosition(from, true),
      b = this.domPosition(to, true);
    if (!a || !b) return [];
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    return Array.from(range.getClientRects());
  }
  /** Snapshot only editable text. Browser-owned composition can be diffed without serializing HTML. */
  capture() {
    let text = "";
    const positions: number[] = [];
    const ends: number[] = [];
    const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (
        node.parentElement?.closest(
          '[contenteditable="false"], [data-native-ui]',
        )
      )
        continue;
      const m = this.byNode.get(node);
      for (let i = 0; i < (node.textContent?.length ?? 0); i++) {
        positions.push(
          m ? m.offsets[i] + (m.shift ?? 0) : (positions.at(-1) ?? 0),
        );
        ends.push(
          m
            ? (m.offsets[i + 1] ?? m.offsets.at(-1)!) + (m.shift ?? 0)
            : (ends.at(-1) ?? 0),
        );
      }
      text += node.textContent ?? "";
    }
    positions.push(this.maps.at(-1)?.to ?? 0);
    return { text, positions, ends };
  }
}

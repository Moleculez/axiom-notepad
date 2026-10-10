import { label, localeRuntime } from "./client";
import type { MessageValues } from "./index";
/** Lazy values let translated registry labels be composed at paint time.
 * Capture only small presentation data, never an editor, DOM node or document. */
export type BindingValues = MessageValues | (() => MessageValues);
type Binding = {
  element: WeakRef<Node>;
  attribute: string | null;
  source: string;
  values?: BindingValues;
};
// Explicit UI bindings only. No tree traversal, mutation observer or content
// replacement: source-backed DOM, collaboration anchors and history are intact.
const bindings = new Set<Binding>();
const owned = new WeakMap<Node, Map<string | null, Binding>>();
// Long editing sessions may never switch language. Do not retain detached
// controls' message parameters until the next switch just to prune the set.
const cleanup =
  typeof FinalizationRegistry === "undefined"
    ? null
    : new FinalizationRegistry<Binding>((binding) => bindings.delete(binding));
function paint(binding: Binding) {
  const element = binding.element.deref();
  if (!element) {
    bindings.delete(binding);
    return;
  }
  const values =
    typeof binding.values === "function" ? binding.values() : binding.values;
  const value = label(binding.source, values);
  if (binding.attribute === null) element.textContent = value;
  else if (element instanceof Element)
    element.setAttribute(binding.attribute, value);
}
let lastTranslator = localeRuntime.snapshot().translate;
localeRuntime.subscribe(() => {
  const translator = localeRuntime.snapshot().translate;
  if (lastTranslator === translator) return;
  lastTranslator = translator;
  for (const binding of bindings) paint(binding);
});
function bind(
  element: Node,
  attribute: string | null,
  source: string,
  values?: BindingValues,
) {
  let properties = owned.get(element);
  if (!properties) {
    properties = new Map();
    owned.set(element, properties);
  }
  const existing = properties.get(attribute);
  if (existing) {
    existing.source = source;
    existing.values = values;
    paint(existing);
    return;
  }
  const binding: Binding = {
    element: new WeakRef(element),
    attribute,
    source,
    values,
  };
  properties.set(attribute, binding);
  bindings.add(binding);
  cleanup?.register(element, binding, binding);
  paint(binding);
}
export const bindText = (
  element: Node,
  source: string,
  values?: BindingValues,
) => bind(element, null, source, values);
export const bindAttribute = (
  element: Element,
  attribute: string,
  source: string,
  values?: BindingValues,
) => bind(element, attribute, source, values);
/** Remove ownership before clearing a conditional attribute. A later locale
 * switch must not restore a stale disabled reason or accessible description. */
export function unbindAttribute(element: Element, attribute: string) {
  const properties = owned.get(element);
  const binding = properties?.get(attribute);
  if (!binding) return;
  properties!.delete(attribute);
  bindings.delete(binding);
  cleanup?.unregister(binding);
}
export const boundMessage = (element: Node, attribute: string | null) =>
  owned.get(element)?.get(attribute)?.source;

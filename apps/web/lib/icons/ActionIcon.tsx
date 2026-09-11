import { createElement } from "react";
import { actionIconNodes, type ActionIconName } from "./actions";

/** React adapter for the same geometry used by native-DOM editor menus. */
export function ActionIcon({ name }: { name: ActionIconName }) {
  return (
    <svg
      className="action-icon"
      data-icon={name}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {actionIconNodes(name).map(([tag, attributes], key) =>
        createElement(tag, { ...attributes, key }),
      )}
    </svg>
  );
}

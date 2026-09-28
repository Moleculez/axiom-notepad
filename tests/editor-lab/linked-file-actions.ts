import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import LinkedFileActions from "../../apps/web/components/media/LinkedFileActions";
import {
  WorkspaceContext,
  type OpenResource,
  type WorkspaceContextValue,
} from "../../apps/web/components/workspace/ui";

// Mount the production action panel against the in-memory editor. Tests mock
// all API reads; opening/revealing a file records intent without navigation.
let host: HTMLDivElement | null = null;
let root: Root | null = null;
const opened: { resource: OpenResource; split: boolean }[] = [];
const navigated: string[] = [];
const destroy = () => {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
};
const mount = () => {
  destroy();
  opened.length = 0;
  navigated.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  // Only the context members consumed by actions and FileIdentity are needed.
  const context: Pick<WorkspaceContextValue, "session" | "open" | "navigate"> =
    {
      session: {
        user: {
          id: "linked-file-actions-lab",
          name: "Researcher",
          email: "lab@example.test",
        },
        groups: [],
        emailAvailable: false,
      },
      open: (resource: OpenResource, split = false) =>
        opened.push({ resource, split }),
      navigate: (path: string) => navigated.push(path),
    };
  flushSync(() =>
    root!.render(
      createElement(
        WorkspaceContext.Provider,
        { value: context as WorkspaceContextValue },
        createElement(LinkedFileActions, {
          root: {
            current: document.querySelector<HTMLElement>('[data-pane="0"]'),
          },
        }),
      ),
    ),
  );
};
window.linkedFileActionsLab = { mount, destroy, opened, navigated };
declare global {
  interface Window {
    linkedFileActionsLab: {
      mount: typeof mount;
      destroy: typeof destroy;
      opened: typeof opened;
      navigated: typeof navigated;
    };
  }
}

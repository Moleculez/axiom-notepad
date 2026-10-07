import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { useResearch } from "../../apps/web/lib/research-store";

/** Browser-local hook fixture; never connects to an account or test server. */
export function researchLifetimeFixture(user: string, group: string) {
  const mount = document.createElement("div");
  document.body.append(mount);
  const root = createRoot(mount);
  let latest: ReturnType<typeof useResearch> | undefined;
  function Surface({ user, group }: { user: string; group: string }) {
    latest = useResearch(user, group);
    return null;
  }
  const render = (user: string, group: string) =>
    root.render(createElement(Surface, { user, group }));
  render(user, group);
  return {
    render,
    snapshot: () => latest,
    close() {
      root.unmount();
      mount.remove();
    },
  };
}

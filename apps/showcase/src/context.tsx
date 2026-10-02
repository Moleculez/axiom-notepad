import { createContext, useContext, useSyncExternalStore } from "react";
import type { RenderContext } from "@axiom/markdown";
import type { Preferences } from "@axiom/shared/appearance";
import { ShowcaseStore } from "./store";

export const store = new ShowcaseStore();
export type Destination = "tour" | "editor" | "canvas";
export type DemoContext = {
  dark: boolean;
  notify: (message: string) => void;
  open: (id: string) => void;
  navigate: (destination: Destination, id?: string) => void;
  changeAppearance: (change: Partial<Preferences>) => void;
  renderContext: () => RenderContext;
};
export const Demo = createContext<DemoContext | null>(null);
export function useDemo() {
  const value = useContext(Demo);
  if (!value) throw new Error("Showcase host missing");
  return value;
}
export function useSnapshot() {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}
export function localRenderContext(dark: boolean): RenderContext {
  return {
    theme: dark ? "dark" : "light",
    resolveImage: store.resolveImage,
    resolveLink: (target) => {
      const doc = store
        .getSnapshot()
        .documents.find(
          (d) =>
            d.id === target || d.title.toLowerCase() === target.toLowerCase(),
        );
      return doc
        ? {
            title: doc.title,
            href: `#${doc.kind === "canvas" ? "canvas" : "editor"}&note=${doc.id}`,
          }
        : undefined;
    },
    references: {
      spectral2026: {
        title:
          "Spectral representations under perturbation (fictional example)",
        authors: "Spectral Lab",
        year: "2026",
      },
    },
  };
}

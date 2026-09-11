"use client";
import { useEffect } from "react";
import type { MathRequest, MathResult } from "@axiom/markdown";
import { clearMarkdownCommandCache } from "@axiom/markdown";

// The synchronous Markdown renderer emits safe source placeholders. This shared
// host covers Write, Read, dialogs and settings without importing TeX on the UI
// thread. Jobs are bounded; a stuck renderer is terminated, never the editor.
export default function MathRendering() {
  useEffect(() => {
    let worker: Worker | undefined,
      alive = true,
      serial = 0;
    let current:
      { id: number; key: string; nodes: Set<HTMLElement> } | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const queue = new Map<string, Set<HTMLElement>>(),
      cache = new Map<string, MathResult>();
    let cacheBytes = 0;
    let pending = new WeakMap<HTMLElement, string>();
    const reset = () => {
      clearTimeout(deadline);
      worker?.terminate();
      worker = undefined;
      current = undefined;
      queue.clear();
      cache.clear();
      cacheBytes = 0;
      pending = new WeakMap();
      clearMarkdownCommandCache();
    };
    const paint = (node: HTMLElement, key: string, result: MathResult) => {
      if (!alive || !node.isConnected || node.dataset.mathRequest !== key)
        return;
      if (result.css && !document.getElementById("axiom-mathjax-style")) {
        const style = document.createElement("style");
        style.id = "axiom-mathjax-style";
        style.textContent = result.css;
        document.head.append(style);
      }
      node.innerHTML = result.html;
      node.dataset.mathState = result.error ? "error" : "ready";
      node.setAttribute("aria-busy", "false");
      if (result.error) node.title = result.error;
      else node.removeAttribute("title");
      node.dispatchEvent(
        new CustomEvent("axiom:math-rendered", {
          bubbles: true,
          detail: result,
        }),
      );
    };
    const finish = (result: MathResult) => {
      if (!current) return;
      clearTimeout(deadline);
      const { key, nodes } = current;
      current = undefined;
      if (cache.size >= 512 || cacheBytes > 12_000_000) {
        cache.clear();
        cacheBytes = 0;
      }
      cache.set(key, result);
      cacheBytes += result.html.length;
      nodes.forEach((node) => paint(node, key, result));
      queueMicrotask(pump);
    };
    const failed = () => {
      worker?.terminate();
      worker = undefined;
      finish({
        html: '<span class="math-error">Preview unavailable · TeX source is preserved.</span>',
        css: "",
        error:
          "Math rendering timed out or could not load. Edit the source to retry.",
      });
    };
    const pump = () => {
      if (!alive || current) return;
      const next = queue.entries().next().value;
      if (!next) return;
      const [key, nodes] = next;
      queue.delete(key);
      for (const node of nodes)
        if (!node.isConnected || node.dataset.mathRequest !== key)
          nodes.delete(node);
      if (!nodes.size) {
        queueMicrotask(pump);
        return;
      }
      current = { id: ++serial, key, nodes };
      try {
        const starting = !worker;
        if (!worker) {
          worker = new Worker(
            new URL("../lib/math.worker.ts", import.meta.url),
          );
          worker.onmessage = (
            event: MessageEvent<{ id: number; result: MathResult }>,
          ) => {
            if (event.data.id === current?.id) finish(event.data.result);
          };
          worker.onerror = (event) => {
            event.preventDefault();
            failed();
          };
        }
        worker.postMessage({
          id: current.id,
          request: JSON.parse(key) as MathRequest,
        });
        deadline = setTimeout(failed, starting ? 15000 : 1500);
      } catch {
        failed();
      }
    };
    const enqueue = (node: HTMLElement) => {
      const key = node.dataset.mathRequest;
      if (
        !key ||
        pending.get(node) === key ||
        node.dataset.mathState === "ready"
      )
        return;
      pending.set(node, key);
      const cached = cache.get(key);
      if (cached) {
        paint(node, key, cached);
        return;
      }
      if (current?.key === key) current.nodes.add(node);
      else {
        if (!queue.has(key) && queue.size >= 512) {
          paint(node, key, {
            html: '<span class="math-error">Preview queue is full · TeX source is preserved.</span>',
            css: "",
            error:
              "Too many equations are waiting. Reopen the note after the current previews finish.",
          });
          return;
        }
        const nodes = queue.get(key) ?? new Set();
        nodes.add(node);
        queue.set(key, nodes);
      }
      pump();
    };
    const visibility = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            visibility.unobserve(entry.target);
            enqueue(entry.target as HTMLElement);
          }
      },
      { rootMargin: "600px" },
    );
    const scan = (root: Node) => {
      if (!(root instanceof Element)) return;
      if (root.matches("[data-math-request]")) visibility.observe(root);
      root
        .querySelectorAll("[data-math-request]")
        .forEach((node) => visibility.observe(node));
    };
    const observer = new MutationObserver((changes) => {
      for (const change of changes) {
        if (change.type === "attributes") scan(change.target);
        else change.addedNodes.forEach(scan);
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-math-request"],
    });
    const account = new MutationObserver(() => {
      reset();
      scan(document.body);
    });
    account.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-math-account"],
    });
    const printing = () => {
      document
        .querySelectorAll<HTMLElement>("[data-math-request]")
        .forEach(enqueue);
    };
    window.addEventListener("beforeprint", printing);
    window.addEventListener("axiom:prepare-print", printing);
    scan(document.body);
    return () => {
      alive = false;
      reset();
      observer.disconnect();
      account.disconnect();
      visibility.disconnect();
      window.removeEventListener("beforeprint", printing);
      window.removeEventListener("axiom:prepare-print", printing);
    };
  }, []);
  return null;
}

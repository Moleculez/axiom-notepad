"use client";
import { useEffect, useState } from "react";
import type { RevisionContent } from "@axiom/shared/revisions";
import { api, SIGN_OUT_PENDING } from "./client";

type Visit = { users: number; previous: Promise<RevisionContent | null> };
const visits = new Map<string, Visit>();
if (typeof window !== "undefined")
  window.addEventListener("axiom:close-documents", () => visits.clear());

/** One durable captured baseline per actual file visit, not per render/StrictMode
 * effect. A separate in-memory previous capture stays stable while editing. */
export function useRevisionVisit(
  account: string,
  resource: string,
  active = true,
) {
  const [previous, setPrevious] = useState<RevisionContent | null | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!active || !navigator.onLine || localStorage.getItem(SIGN_OUT_PENDING))
      return;
    const key = account + ":" + resource;
    let visit = visits.get(key);
    if (!visit) {
      visit = {
        users: 0,
        previous: api<RevisionContent | null>(
          "resources/" + resource + "/review-visit",
          {
            method: "POST",
            body: JSON.stringify({ mutationId: crypto.randomUUID() }),
          },
        ),
      };
      visits.set(key, visit);
    }
    const current = visit;
    current.users++;
    let alive = true;
    void current.previous
      .then((value) => {
        if (alive) setPrevious(value);
      })
      .catch(() => {
        // An offline/expired access failure must never interfere with opening a file.
        if (visits.get(key) === current) visits.delete(key);
      });
    return () => {
      alive = false;
      current.users--;
      queueMicrotask(() => {
        if (!current.users && visits.get(key) === current) visits.delete(key);
      });
    };
  }, [account, resource, active]);
  return previous;
}

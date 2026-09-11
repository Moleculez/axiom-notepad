"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  allowVerifiedOfflineDataset,
  clearReplacedDataset,
  DATASET_KEY,
  DATASET_RESET,
  verifyDataset,
  type DatasetIdentity,
} from "../lib/dataset";
import DevelopmentSetup from "./DevelopmentSetup";

export default function DatasetBoundary({ children }: { children: ReactNode }) {
  const [state, setState] = useState<
      "checking" | "ready" | "setup" | "reset" | "error"
    >("checking"),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0),
    replacement = useRef<DatasetIdentity | null>(null);
  useEffect(() => {
    let alive = true;
    const reset = (event: Event) => {
      replacement.current = (event as CustomEvent<DatasetIdentity>).detail;
      setState("reset");
    };
    const verify = async () => {
      try {
        const identity = await verifyDataset();
        if (alive && !replacement.current)
          setState(identity.setupRequired ? "setup" : "ready");
      } catch (error) {
        if (!alive || replacement.current) return;
        if (allowVerifiedOfflineDataset()) setState("ready");
        else {
          setError((error as Error).message);
          setState("error");
        }
      }
    };
    const storage = (event: StorageEvent) => {
      if (event.key === DATASET_KEY) {
        setState("checking");
        void verify();
      }
    };
    window.addEventListener(DATASET_RESET, reset);
    window.addEventListener("online", verify);
    window.addEventListener("storage", storage);
    const timer = setInterval(() => {
      if (navigator.onLine) void verify();
    }, 15000);
    void verify();
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener(DATASET_RESET, reset);
      window.removeEventListener("online", verify);
      window.removeEventListener("storage", storage);
    };
  }, [attempt]);
  useEffect(() => {
    if (state !== "reset" || !replacement.current) return;
    let alive = true;
    // React has now unmounted providers/journals. Old offline operations cannot
    // reopen resources while their database is being removed.
    void clearReplacedDataset(replacement.current)
      .then(() => {
        if (alive) {
          replacement.current = null;
          location.replace("/workbench/home");
        }
      })
      .catch((error) => {
        if (alive) {
          setError(error.message);
          setState("error");
        }
      });
    return () => {
      alive = false;
    };
  }, [state, attempt]);
  if (state === "ready") return children;
  if (state === "setup")
    return (
      <DevelopmentSetup
        completed={() => {
          setState("checking");
          setAttempt((n) => n + 1);
        }}
      />
    );
  return (
    <main className="ws-boot">
      <span className="brand-mark">a</span>
      <p role={state === "error" ? "alert" : "status"}>
        {state === "reset"
          ? "Clearing replaced development data and signing out…"
          : state === "error"
            ? error
            : "Checking your workspace…"}
      </p>
      {state === "error" && (
        <button
          className="button secondary"
          onClick={() => {
            setState(replacement.current ? "reset" : "checking");
            setAttempt((n) => n + 1);
          }}
        >
          Retry
        </button>
      )}
    </main>
  );
}

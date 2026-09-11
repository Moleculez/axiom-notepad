"use client";
import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { documentsSavedLocally } from "../../lib/document-sessions";
import { useWorkspace } from "./ui";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
export default function InstallControls() {
  const { notify } = useWorkspace(),
    [install, setInstall] = useState<InstallEvent | null>(null),
    [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    const prompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", prompt);
    let alive = true;
    const update = (registration: ServiceWorkerRegistration) => {
      if (alive && registration.waiting) setWaiting(registration.waiting);
    };
    void navigator.serviceWorker?.getRegistration().then((r) => {
      if (!r) return;
      update(r);
      r.addEventListener("updatefound", () =>
        r.installing?.addEventListener("statechange", () => update(r)),
      );
    });
    return () => {
      alive = false;
      window.removeEventListener("beforeinstallprompt", prompt);
    };
  }, []);
  return (
    <div className="offline-install-controls">
      {install ? (
        <button
          className="button secondary"
          onClick={() =>
            void install
              .prompt()
              .then(() => install.userChoice)
              .then((result) => {
                if (result.outcome === "accepted") setInstall(null);
              })
          }
        >
          <Download size={16} />
          Install Axiom
        </button>
      ) : (
        <p className="ws-note">
          Install from your browser’s address bar or “Add to Dock” menu for a
          dedicated app window. Installation requires HTTPS or localhost.
        </p>
      )}
      {waiting && (
        <button
          className="button primary"
          onClick={() => {
            if (
              !documentsSavedLocally() ||
              document.querySelector(".image-studio,.math-visual")
            ) {
              notify(
                "Finish saving and close the active studio before updating. Your local work has not been discarded.",
              );
              return;
            }
            navigator.serviceWorker.addEventListener(
              "controllerchange",
              () => location.reload(),
              { once: true },
            );
            waiting.postMessage({ type: "axiom:activate-update" });
          }}
        >
          <RefreshCw size={16} />
          Apply downloaded update
        </button>
      )}
    </div>
  );
}

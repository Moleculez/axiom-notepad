"use client";
import { I18nText } from "@axiom/i18n/react";

import { Button } from "../ui/controls";
import { useEffect, useState } from "react";
import Dialog from "../Dialog";

export default function DraftGuard({
  dirty,
  title,
}: {
  dirty: boolean;
  title: string;
}) {
  const [leave, setLeave] = useState<(() => void) | null>(null);
  useEffect(() => {
    if (!dirty) return;
    const before = (event: Event) => {
      event.preventDefault();
      setLeave(
        () => (event as CustomEvent<{ proceed: () => void }>).detail.proceed,
      );
    };
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("axiom:before-navigate", before);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("axiom:before-navigate", before);
      window.removeEventListener("beforeunload", unload);
    };
  }, [dirty]);
  return leave ? (
    <Dialog title={title} onClose={() => setLeave(null)}>
      <p>
        <I18nText id="Your changes have not been saved. Keep editing, or discard them when leaving this page." />
      </p>
      <div className="dialog-footer">
        <Button
          data-dialog-cancel
          className="button secondary"
          onClick={() => setLeave(null)}
        >
          <I18nText id="Keep editing" />
        </Button>
        <Button
          className="button primary"
          onClick={() => {
            const proceed = leave;
            setLeave(null);
            proceed();
          }}
        >
          <I18nText id="Discard and leave" />
        </Button>
      </div>
    </Dialog>
  ) : null;
}

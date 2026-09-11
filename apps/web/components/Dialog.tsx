"use client";
import { createContext, useContext, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

const OpenerContext = createContext<{ current: HTMLElement | null } | null>(
  null,
);
/** Safari does not focus buttons on pointer clicks. Remember the trigger
 * without moving focus (which would discard an editor selection/bookmark). */
export function DialogFocusBoundary({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  const opener = useRef<HTMLElement | null>(null);
  return (
    <OpenerContext.Provider value={opener}>
      <div
        className={className}
        onPointerDownCapture={(event) => {
          if (event.button !== 0) return;
          const control =
            event.target instanceof Element
              ? event.target.closest(
                  "button, a[href], input, select, textarea, [tabindex]",
                )
              : null;
          opener.current = control instanceof HTMLElement ? control : null;
        }}
        onKeyDownCapture={() => {
          opener.current = null;
        }}
      >
        {children}
      </div>
    </OpenerContext.Provider>
  );
}

export default function Dialog({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  size,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  size?: "compact" | "standard" | "wide" | "settings";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const trigger = useContext(OpenerContext);
  const closeRef = useRef(onClose),
    outsideDown = useRef(false),
    titleId = useId(),
    subtitleId = useId();
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current!;
    const originalOpener = trigger?.current?.isConnected
      ? trigger.current
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    // A dropdown action closes its disclosure before opening a dialog.
    // Return to its visible trigger, not the now-hidden action button.
    const opener =
      originalOpener
        ?.closest("details:not([open])")
        ?.querySelector("summary") ?? originalOpener;
    dialog.showModal();
    // Strict Mode replays effects. Ignore an earlier cleanup's queued close
    // event if this dialog has already been opened again.
    const close = () => {
      if (!dialog.open) closeRef.current();
    };
    dialog.addEventListener("close", close);
    return () => {
      dialog.removeEventListener("close", close);
      // Native Escape can close the dialog before React unmounts it. Do not
      // steal focus if the user has already moved to another control.
      const active = document.activeElement;
      const restore =
        !active || active === document.body || dialog.contains(active);
      dialog.close();
      // Native focus restoration is supplemented for opener buttons moved by React.
      if (restore && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  const outside = (event: React.PointerEvent<HTMLDialogElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return (
      event.target === event.currentTarget &&
      (event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom)
    );
  };
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "wide" : ""}`}
      data-size={size ?? (wide ? "wide" : "standard")}
      onPointerDown={(event) => {
        outsideDown.current = event.button === 0 && outside(event);
      }}
      onPointerUp={(event) => {
        if (outsideDown.current && outside(event)) onClose();
        outsideDown.current = false;
      }}
      onPointerCancel={() => {
        outsideDown.current = false;
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter(
          (element) =>
            !element.matches(':disabled, [tabindex="-1"]') &&
            !element.closest("[hidden], [inert]") &&
            element.getClientRects().length > 0,
        );
        const first = controls[0],
          last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
    >
      <div className="dialog-heading">
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && (
            <p id={subtitleId} className="muted">
              {subtitle}
            </p>
          )}
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}

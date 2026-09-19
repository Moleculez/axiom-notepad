"use client";
import {
  Children,
  Fragment,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type ReactElement,
  type RefObject,
} from "react";
import type { AppPrompt } from "../lib/app-prompt";
import { X } from "lucide-react";

export function DialogBody({ children }: { children: ReactNode }) {
  return <div className="dialog-body">{children}</div>;
}
export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="dialog-footer">{children}</div>;
}
function flatten(children: ReactNode): ReactNode[] {
  // React composes parent and child keys when a mapping returns an array.
  // Array.flatMap drops that scope, so a fragment's first child can collide
  // with a sibling's generated ".0" key (or another group's explicit key).
  return (
    Children.map(children, (child) =>
      isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
        ? flatten(child.props.children)
        : child,
    ) ?? []
  );
}
/** Supports existing callers while keeping form ownership and actions outside the scrollport. */
export function DialogContent({ children }: { children: ReactNode }) {
  const nodes = flatten(children);
  const form =
    nodes.length === 1 &&
    isValidElement<{ children?: ReactNode; className?: string }>(nodes[0]) &&
    nodes[0].type === "form"
      ? nodes[0]
      : null;
  if (form)
    return cloneElement(
      form,
      { className: `${form.props.className ?? ""} dialog-form` },
      <DialogContent>{form.props.children}</DialogContent>,
    );
  const isFooter = (node: ReactNode) =>
    isValidElement<{ className?: string }>(node) &&
    (node.type === DialogFooter ||
      /(?:^|\s)dialog-(?:footer|actions)(?:\s|$)/.test(
        node.props.className ?? "",
      ));
  const body =
    Children.map(
      nodes.filter((node) => !isFooter(node)),
      (node) =>
        isValidElement<{ children?: ReactNode }>(node) &&
        node.type === DialogBody
          ? flatten(node.props.children)
          : node,
    ) ?? [];
  const footer = nodes.filter(isFooter);
  return (
    <>
      {body.length > 0 && <DialogBody>{body}</DialogBody>}
      {footer.map((node, index) => {
        const element = node as ReactElement<{ children?: ReactNode }>;
        return (
          <DialogFooter key={element.key ?? index}>
            {element.props.children}
          </DialogFooter>
        );
      })}
    </>
  );
}

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
        <AppPromptHost />
      </div>
    </OpenerContext.Provider>
  );
}

function AppPromptHost() {
  const [pending, setPending] = useState<AppPrompt[]>([]);
  const current = useRef(pending);
  current.current = pending;
  const [text, setText] = useState("");
  useEffect(() => {
    const listener = (event: Event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      const request = (event as CustomEvent<AppPrompt>).detail;
      current.current = [...current.current, request];
      setPending(current.current);
    };
    const cancel = () => {
      current.current.forEach((request) => request.resolve(null));
      current.current = [];
      setPending([]);
    };
    window.addEventListener("axiom:prompt", listener);
    window.addEventListener("axiom:route", cancel);
    window.addEventListener("axiom:close-documents", cancel);
    return () => {
      window.removeEventListener("axiom:prompt", listener);
      window.removeEventListener("axiom:route", cancel);
      window.removeEventListener("axiom:close-documents", cancel);
      current.current.forEach((request) => request.resolve(null));
    };
  }, []);
  const request = pending[0];
  const finish = (value: string | null) => {
    request?.resolve(value);
    setText("");
    current.current = current.current.slice(1);
    setPending(current.current);
  };
  return request ? (
    <Dialog title={request.title} size="compact" onClose={() => finish(null)}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!request.input || text.trim()) finish(text.trim());
        }}
      >
        <p>{request.message}</p>
        {request.input && (
          <label>
            Name
            <input
              autoFocus
              maxLength={300}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
        )}
        <DialogFooter>
          <button
            type="button"
            autoFocus={!request.input}
            className="button secondary"
            onClick={() => finish(null)}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`button ${request.destructive ? "danger" : "primary"}`}
            disabled={request.input && !text.trim()}
          >
            {request.confirmLabel}
          </button>
        </DialogFooter>
      </form>
    </Dialog>
  ) : null;
}

export default function Dialog({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  size,
  surfaceRef,
  expanded = false,
  onEscape,
  returnFocus,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  size?: "compact" | "standard" | "wide" | "settings" | "visual";
  /** Optional valid fullscreen target; native dialog elements cannot fullscreen. */
  surfaceRef?: RefObject<HTMLDivElement | null>;
  expanded?: boolean;
  onEscape?: () => void;
  /** Resolve a stable opener when a refreshed list may replace its DOM node. */
  returnFocus?: () => HTMLElement | null;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const trigger = useContext(OpenerContext);
  const closeRef = useRef(onClose),
    outsideDown = useRef(false),
    titleId = useId(),
    subtitleId = useId();
  closeRef.current = onClose;
  const focusRef = useRef(returnFocus);
  focusRef.current = returnFocus;
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
      const target = focusRef.current?.() ?? opener;
      if (restore && target?.isConnected) target.focus({ preventScroll: true });
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
  const content = (
    <>
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
      <DialogContent>{children}</DialogContent>
    </>
  );
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "wide" : ""} ${className}`}
      data-size={size ?? (wide ? "wide" : "standard")}
      data-expanded={expanded || undefined}
      onCancel={(event) => {
        // Native Escape must use the same busy/dirty guard as Close and backdrop clicks.
        event.preventDefault();
        if (onEscape) onEscape();
        else closeRef.current();
      }}
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
      {surfaceRef ? (
        <div className="dialog-surface" ref={surfaceRef}>
          {content}
        </div>
      ) : (
        content
      )}
    </dialog>
  );
}

"use client";

import {
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  Search,
  X,
  ChevronDown,
  Check,
  RefreshCw,
} from "lucide-react";
import { claimEditorOverlay } from "../../lib/editor-popover";

const classes = (...values: Array<string | undefined | false>) =>
  [...new Set(values.filter(Boolean).join(" ").split(/\s+/))]
    .filter(Boolean)
    .join(" ");

/** Native field ownership: form, autofill, validity, selection and refs survive. */
export const TextInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function TextInput({ className, ...props }, ref) {
  return (
    <input {...props} ref={ref} className={classes("ui-input", className)} />
  );
});
export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea({ className, ...props }, ref) {
  return (
    <textarea
      {...props}
      ref={ref}
      className={classes("ui-input ui-textarea", className)}
    />
  );
});
export const NativeSelect = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function NativeSelect({ className, ...props }, ref) {
  return (
    <select
      {...props}
      ref={ref}
      className={classes("ui-input ui-select", className)}
    />
  );
});

/** One field surface; adornments never become a second label or editable value. */
export function InputGroup({
  leading,
  trailing,
  children,
  className,
  id,
  "aria-describedby": described,
  "aria-invalid": invalid,
  ...props
}: Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  leading?: ReactNode;
  trailing?: ReactNode;
  children: ReactElement<{
    className?: string;
    id?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: HTMLAttributes<HTMLElement>["aria-invalid"];
  }>;
}) {
  return (
    <span
      {...props}
      className={classes("ui-input-group", className)}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented && event.target === event.currentTarget)
          event.currentTarget.querySelector<HTMLInputElement>("input")?.focus();
      }}
    >
      {leading && (
        <span className="ui-input-leading" aria-hidden="true">
          {leading}
        </span>
      )}
      {cloneElement(children, {
        className: classes("ui-input-group-control", children.props.className),
        id: id ?? children.props.id,
        "aria-describedby":
          [children.props["aria-describedby"], described]
            .filter(Boolean)
            .join(" ") || undefined,
        "aria-invalid": invalid ?? children.props["aria-invalid"],
      })}
      {trailing && <span className="ui-input-trailing">{trailing}</span>}
    </span>
  );
}

type SearchFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Layout belongs on the group, native props/className stay on the input. */
  wrapperClassName?: string;
  onClear?: () => void;
  clearLabel?: string;
  /** Use only for a different search scope, e.g. commands. Decorative only. */
  icon?: ReactNode;
};
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(
  function SearchField(
    {
      className,
      value,
      defaultValue,
      onChange,
      disabled,
      readOnly,
      wrapperClassName,
      onClear,
      clearLabel = "Clear search",
      icon = <Search aria-hidden="true" />,
      ...props
    },
    ref,
  ) {
    const input = useRef<HTMLInputElement>(null);
    const [hasDraft, setHasDraft] = useState(Boolean(defaultValue));
    useImperativeHandle(ref, () => input.current!);
    const hasValue = value === undefined ? hasDraft : Boolean(value);
    return (
      <InputGroup
        className={classes("ui-search-field", wrapperClassName)}
        leading={icon}
        trailing={
          onClear && (
            <span className="ui-search-clear-slot">
              {hasValue && (
                <IconButton
                  type="button"
                  label={clearLabel}
                  disabled={disabled || readOnly}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (input.current?.matches(":disabled")) return;
                    if (value === undefined && input.current) {
                      input.current.value = "";
                      setHasDraft(false);
                    }
                    onClear();
                    input.current?.focus();
                  }}
                >
                  <X aria-hidden="true" />
                </IconButton>
              )}
            </span>
          )
        }
      >
        <TextInput
          {...props}
          type="search"
          ref={input}
          className={className}
          value={value}
          defaultValue={defaultValue}
          onChange={(event) => {
            setHasDraft(Boolean(event.target.value));
            onChange?.(event);
          }}
          disabled={disabled}
          readOnly={readOnly}
        />
      </InputGroup>
    );
  },
);

export type PickerOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};
export type PickerProps = {
  value: string | string[];
  onChange: (value: string | string[]) => void;
  options?: PickerOption[];
  selectedOptions?: PickerOption[];
  loadOptions?: (query: string, signal: AbortSignal) => Promise<PickerOption[]>;
  label: string;
  id?: string;
  name?: string;
  multiple?: boolean;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: InputHTMLAttributes<HTMLInputElement>["aria-invalid"];
};

/** Select-only entity picker. Query text is never a selected ID or a form value. */
export function Picker({
  value,
  onChange,
  options = [],
  selectedOptions = [],
  loadOptions,
  label,
  id: suppliedId,
  name,
  multiple = false,
  disabled = false,
  required = false,
  placeholder = "Choose…",
  "aria-describedby": described,
  "aria-invalid": invalid,
}: PickerProps) {
  const generated = useId(),
    id = suppliedId ?? generated;
  const root = useRef<HTMLSpanElement>(null),
    input = useRef<HTMLInputElement>(null),
    popup = useRef<HTMLSpanElement>(null),
    validity = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0),
    [loaded, setLoaded] = useState<PickerOption[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [position, setPosition] = useState({
      left: 0,
      top: 0,
      width: 240,
      height: 300,
    });
  const ids = Array.isArray(value) ? value : value ? [value] : [];
  const matches = loadOptions
    ? loaded
    : options.filter((o) =>
        `${o.label} ${o.description ?? ""}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
      );
  const choices = matches.slice(0, 100);
  const known = useRef(new Map<string, PickerOption>());
  for (const o of [...options, ...loaded, ...selectedOptions])
    known.current.set(o.value, o);
  const all = known.current;
  useEffect(() => {
    validity.current?.setCustomValidity(
      required && !ids.length ? "Choose an option." : "",
    );
  }, [required, ids.join("\0")]);
  useEffect(() => {
    if (!open || !loadOptions) return;
    const abort = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      void loadOptions(query, abort.signal)
        .then((rows) => {
          if (!abort.signal.aborted) {
            setLoaded(rows);
            setActive(0);
          }
        })
        .catch((e) => {
          if (!abort.signal.aborted)
            setError(e.message || "Could not load choices.");
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [open, query, loadOptions, retry]);
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const b = root.current!.getBoundingClientRect(),
        height = Math.min(320, Math.max(140, innerHeight - 24));
      setPosition({
        left: Math.max(
          12,
          Math.min(b.left, innerWidth - Math.max(240, b.width) - 12),
        ),
        top:
          innerHeight - b.bottom > height + 8
            ? b.bottom + 4
            : Math.max(12, b.top - height - 4),
        width: Math.min(innerWidth - 24, Math.max(240, b.width)),
        height,
      });
    };
    measure();
    const outside = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const release = claimEditorOverlay(() => setOpen(false));
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", measure);
    document.addEventListener("scroll", measure, true);
    const p = popup.current;
    if (p && typeof p.showPopover === "function") p.showPopover();
    return () => {
      release();
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", measure);
      document.removeEventListener("scroll", measure, true);
      if (p?.matches(":popover-open")) p.hidePopover();
    };
  }, [open]);
  useEffect(() => {
    if (open)
      popup.current
        ?.querySelector(`[data-active="true"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const show = () => {
    if (disabled || input.current?.matches(":disabled")) return;
    setQuery("");
    setActive(0);
    setOpen(true);
    input.current?.focus();
  };
  const choose = (option: PickerOption) => {
    if (
      option.disabled ||
      loading ||
      error ||
      input.current?.matches(":disabled")
    )
      return;
    onChange(
      multiple
        ? ids.includes(option.value)
          ? ids.filter((v) => v !== option.value)
          : [...ids, option.value]
        : option.value,
    );
    if (!multiple) setOpen(false);
    input.current?.focus();
  };
  return (
    <span
      ref={root}
      className="ui-picker"
      data-disabled={disabled || undefined}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      {name &&
        (multiple ? ids : [ids[0] ?? ""]).map((v, i) => (
          <input
            type="hidden"
            name={name}
            key={i}
            value={v}
            disabled={disabled}
          />
        ))}
      <InputGroup
        className="ui-picker-field"
        trailing={
          <>
            <span className="ui-search-clear-slot">
              {ids.length > 0 && (
                <IconButton
                  type="button"
                  label={`Clear ${label}`}
                  disabled={disabled}
                  onClick={() => onChange(multiple ? [] : "")}
                >
                  <X aria-hidden="true" />
                </IconButton>
              )}
            </span>
            <IconButton
              type="button"
              label={`Show ${label}`}
              disabled={disabled}
              onClick={() => (open ? setOpen(false) : show())}
            >
              <ChevronDown aria-hidden="true" />
            </IconButton>
          </>
        }
      >
        <TextInput
          id={id}
          ref={input}
          role="combobox"
          aria-label={label}
          aria-controls={`${id}-list`}
          aria-expanded={open}
          aria-autocomplete="list"
          aria-describedby={described}
          aria-invalid={invalid}
          aria-required={required || undefined}
          aria-activedescendant={
            open && choices[active] && !loading && !error
              ? `${id}-option-${active}`
              : undefined
          }
          disabled={disabled}
          autoComplete="off"
          value={
            open
              ? query
              : multiple
                ? ids.length
                  ? `${ids.length} selected`
                  : ""
                : (all.get(ids[0])?.label ??
                  (ids.length ? "Selected item" : ""))
          }
          placeholder={placeholder}
          onClick={() => {
            if (!open) show();
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!open) show();
              else
                setActive((n) =>
                  Math.max(
                    0,
                    Math.min(
                      choices.length - 1,
                      n + (e.key === "ArrowDown" ? 1 : -1),
                    ),
                  ),
                );
            } else if (open && ["Home", "End"].includes(e.key) && !query) {
              e.preventDefault();
              setActive(e.key === "Home" ? 0 : choices.length - 1);
            } else if (e.key === "Enter" && open) {
              e.preventDefault();
              if (choices[active]) choose(choices[active]);
            } else if (e.key === "Escape" && open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            } else if (e.key === "Tab") setOpen(false);
          }}
        />
      </InputGroup>
      <input
        ref={validity}
        className="ui-picker-validity"
        tabIndex={-1}
        aria-label={`${label} selection`}
        value={ids.join(",")}
        onChange={() => {}}
        disabled={disabled}
        onInvalid={(e) => {
          e.preventDefault();
          show();
        }}
      />
      {multiple && ids.length > 0 && (
        <span className="ui-picker-tags">
          {ids.map((v) => (
            <span key={v}>
              <span className="ui-picker-tag-label">
                {all.get(v)?.label ?? "Selected item"}
              </span>
              <IconButton
                type="button"
                label={`Remove ${all.get(v)?.label ?? "selected item"}`}
                disabled={disabled}
                onClick={() => onChange(ids.filter((id) => id !== v))}
              >
                <X size={12} />
              </IconButton>
            </span>
          ))}
        </span>
      )}
      {open && (
        <span
          ref={popup}
          popover="manual"
          className="ui-picker-popup"
          style={{
            left: position.left,
            top: position.top,
            width: position.width,
            maxHeight: position.height,
          }}
        >
          <span
            role="listbox"
            id={`${id}-list`}
            aria-label={label}
            aria-multiselectable={multiple || undefined}
            aria-busy={loading}
          >
            {!loading &&
              !error &&
              choices.map((o, i) => (
                <span
                  role="option"
                  key={o.value}
                  id={`${id}-option-${i}`}
                  aria-selected={ids.includes(o.value)}
                  aria-disabled={o.disabled || undefined}
                  data-active={active === i}
                  className="ui-picker-option"
                  onPointerDown={(e) => e.preventDefault()}
                  onPointerMove={() => setActive(i)}
                  onClick={() => choose(o)}
                >
                  <span>
                    <strong>{o.label}</strong>
                    {o.description && <small>{o.description}</small>}
                  </span>
                  {ids.includes(o.value) && (
                    <Check size={15} aria-hidden="true" />
                  )}
                </span>
              ))}
          </span>
          <span className="ui-picker-status" role="status">
            {loading
              ? "Loading choices…"
              : error ||
                (!choices.length
                  ? "No matches. Try another search."
                  : matches.length >= 100
                    ? "Keep typing to narrow the choices."
                    : `${choices.length} choices`)}
          </span>
          {error && (
            <Button
              type="button"
              variant="ghost"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setRetry((n) => n + 1)}
            >
              <RefreshCw size={14} />
              Retry
            </Button>
          )}
        </span>
      )}
    </span>
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "standard" | "compact";
  /** Keep the action label stable while the request is pending. */
  pending?: boolean;
};

/** A native button: implicit form submission and every native event stay intact. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant, size, pending, className, disabled, children, ...props },
    ref,
  ) {
    return (
      <button
        {...props}
        ref={ref}
        className={classes("button ui-button", variant, className)}
        data-control-size={size}
        data-pending={pending === undefined ? undefined : String(pending)}
        aria-busy={pending || props["aria-busy"] || undefined}
        disabled={disabled || pending}
      >
        {children}
      </button>
    );
  },
);

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label?: string }
>(function IconButton({ label, className, ...props }, ref) {
  return (
    <button
      {...props}
      ref={ref}
      className={classes("icon-button ui-icon-button", className)}
      aria-label={props["aria-label"] ?? label}
      title={props.title ?? label ?? props["aria-label"]}
    />
  );
});

export type CheckboxProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "children" | "dangerouslySetInnerHTML"
> & { indeterminate?: boolean };

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ indeterminate, className, ...props }, ref) {
    const input = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => input.current!, []);
    useEffect(() => {
      // An omitted prop must not overwrite a caller's existing native ref logic.
      if (input.current && indeterminate !== undefined)
        input.current.indeterminate = indeterminate;
    }, [indeterminate]);
    return (
      <input
        {...props}
        ref={input}
        type="checkbox"
        className={classes("ui-checkbox", className)}
        aria-checked={indeterminate ? "mixed" : props["aria-checked"]}
      />
    );
  },
);

export const Switch = forwardRef<
  HTMLInputElement,
  Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "type" | "role" | "children" | "dangerouslySetInnerHTML"
  >
>(function Switch({ className, ...props }, ref) {
  return (
    <input
      {...props}
      ref={ref}
      type="checkbox"
      role="switch"
      className={classes("ui-switch", className)}
    />
  );
});

export const Radio = forwardRef<
  HTMLInputElement,
  Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "type" | "children" | "dangerouslySetInnerHTML"
  >
>(function Radio({ className, ...props }, ref) {
  return (
    <input
      {...props}
      ref={ref}
      type="radio"
      className={classes("ui-checkbox ui-radio", className)}
    />
  );
});

export function sliderProgress(
  value: string | number | readonly string[] | undefined,
  min: string | number = 0,
  max: string | number = 100,
) {
  const start = Number(min),
    end = Number(max);
  const current = value === undefined ? (start + end) / 2 : Number(value);
  if (![start, end, current].every(Number.isFinite) || end <= start) return 0;
  return Math.max(0, Math.min(100, ((current - start) / (end - start)) * 100));
}

export const Slider = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type">
>(function Slider(
  { className, style, min, max, value, defaultValue, onChange, ...props },
  ref,
) {
  return (
    <input
      {...props}
      ref={ref}
      type="range"
      min={min}
      max={max}
      value={value}
      defaultValue={defaultValue}
      className={classes("ui-slider", className)}
      style={
        {
          ...style,
          "--slider-progress": `${sliderProgress(value ?? defaultValue, min, max)}%`,
        } as CSSProperties
      }
      onChange={(event) => {
        // Also updates uncontrolled sliders; no extra React render on each pixel.
        event.currentTarget.style.setProperty(
          "--slider-progress",
          `${sliderProgress(event.currentTarget.value, min, max)}%`,
        );
        onChange?.(event);
      }}
    />
  );
});

export function ActionRow({
  className,
  align,
  size,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  align?: "start" | "end" | "between";
  /** Opt-in common geometry for a mixed toolbar; standalone controls stay unchanged. */
  size?: "standard" | "compact";
}) {
  return (
    <div
      {...props}
      className={classes("ws-actions ui-actions", className)}
      data-align={align}
      data-control-group-size={size}
    />
  );
}

export function HelpText({
  as: Tag = "p",
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { as?: "p" | "div" | "span" | "small" }) {
  return <Tag {...props} className={classes("ui-help", className)} />;
}

export function Notice({
  tone = "info",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  tone?: "info" | "success" | "warning" | "danger";
}) {
  const Icon = {
    info: Info,
    success: CheckCircle2,
    warning: AlertTriangle,
    danger: AlertCircle,
  }[tone];
  return (
    <div
      {...props}
      className={classes("ui-notice", className)}
      data-tone={tone}
    >
      <Icon size={17} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

/** Associates one native/shared control with a label, guidance and inline error. */
export function Field({
  label,
  icon,
  hint,
  error,
  children,
  id: suppliedId,
  className,
  action,
}: {
  label: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactElement<{
    id?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: HTMLAttributes<HTMLElement>["aria-invalid"];
  }>;
  id?: string;
  className?: string;
  action?: ReactNode;
}) {
  const generated = useId(),
    id = suppliedId ?? children.props.id ?? generated;
  const described = [
    children.props["aria-describedby"],
    hint && `${id}-hint`,
    error && `${id}-error`,
  ]
    .filter(Boolean)
    .join(" ");
  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        "aria-describedby": described || undefined,
        "aria-invalid": error ? true : children.props["aria-invalid"],
      })
    : null;
  return (
    <div className={classes("ui-field", className)}>
      <label htmlFor={id}>
        {icon && (
          <span className="ui-field-label-icon" aria-hidden="true">
            {icon}
          </span>
        )}
        <span className="ui-field-label-text">{label}</span>
      </label>
      {action ? (
        <div className="ui-field-control-row">
          {control}
          {action}
        </div>
      ) : (
        control
      )}
      {hint && (
        <HelpText as="small" id={`${id}-hint`}>
          {hint}
        </HelpText>
      )}
      {error && (
        <HelpText
          as="small"
          className="form-error"
          id={`${id}-error`}
          role="alert"
        >
          {error}
        </HelpText>
      )}
    </div>
  );
}

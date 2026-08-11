"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

const TOOLTIP_SURFACE_CLASS =
  "pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-max max-w-[260px] -translate-x-1/2 bg-slate-900 border border-slate-700 text-slate-200 text-xs px-3 py-1.5 rounded shadow-xl";

export type TooltipProps = {
  /** Hover / focus copy shown above the control. */
  content: ReactNode;
  children: ReactNode;
  /** Delay before the tooltip appears (ms). */
  delayDuration?: number;
  /** Extra classes on the wrapper (positioning context). */
  className?: string;
  /** Override the default dark-glass surface classes. */
  contentClassName?: string;
};

/**
 * Lightweight hover/focus tooltip — no Radix dependency.
 * Wraps controls that need richer copy than native `title`.
 */
export function Tooltip({
  content,
  children,
  delayDuration = 200,
  className = "",
  contentClassName,
}: TooltipProps) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearShowTimer = () => {
    if (showTimerRef.current !== null) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  };

  const scheduleShow = () => {
    clearShowTimer();
    showTimerRef.current = setTimeout(() => {
      setOpen(true);
      showTimerRef.current = null;
    }, delayDuration);
  };

  const hide = () => {
    clearShowTimer();
    setOpen(false);
  };

  useEffect(() => () => clearShowTimer(), []);

  return (
    <span
      className={["relative inline-flex max-w-full", className]
        .filter(Boolean)
        .join(" ")}
      onMouseEnter={scheduleShow}
      onMouseLeave={hide}
      onFocus={scheduleShow}
      onBlur={hide}
    >
      {children}
      {open && content != null && content !== false ? (
        <span
          id={tooltipId}
          role="tooltip"
          className={contentClassName ?? TOOLTIP_SURFACE_CLASS}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}

export default Tooltip;

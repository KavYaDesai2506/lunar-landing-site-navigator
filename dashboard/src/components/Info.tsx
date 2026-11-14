import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/** A small "?" that opens the working behind a number, so the number itself can stay bare. */
export default function Info({ label = "How this is worked out", children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState({ left: 0, top: 0 });
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const gone = () => setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", gone, true);
    window.addEventListener("resize", gone);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", gone, true);
      window.removeEventListener("resize", gone);
    };
  }, [open]);

  const toggle = () => {
    if (!open && ref.current) {
      // fixed to the viewport, so a scrolling table or a card edge cannot clip it
      const r = ref.current.getBoundingClientRect();
      const width = Math.min(300, window.innerWidth - 24);
      setAt({ left: Math.max(12, Math.min(r.left - 8, window.innerWidth - 12 - width)), top: r.bottom + 6 });
    }
    setOpen(!open);
  };

  return (
    <span className="info" ref={ref}>
      <button type="button" className="info-btn" aria-expanded={open} aria-label={label} title={label} onClick={toggle}>
        ?
      </button>
      {open && (
        <span className="info-pop" role="note" style={at}>
          {children}
        </span>
      )}
    </span>
  );
}

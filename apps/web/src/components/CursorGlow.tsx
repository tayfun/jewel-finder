import { useEffect, useRef } from "react";

/** A soft glow that follows the mouse pointer, so it's easy to see where it is. Hidden for touch. */
export function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !window.matchMedia("(pointer: fine)").matches) return;
    let frame = 0;
    let x = 0;
    let y = 0;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      x = e.clientX;
      y = e.clientY;
      el.classList.add("on");
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        });
      }
    };
    const hide = () => el.classList.remove("on");
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", hide);
    window.addEventListener("blur", hide);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", hide);
      window.removeEventListener("blur", hide);
    };
  }, []);
  return <div ref={ref} className="cursor-glow" aria-hidden="true" />;
}

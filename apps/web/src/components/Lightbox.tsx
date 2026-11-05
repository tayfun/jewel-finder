import { useEffect, useRef } from "react";
import { Photo } from "./Photo";

/** Full-screen photo viewer. ←/→ move between photos, Esc or a click on the backdrop closes it. */
export function Lightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: string[];
  index: number;
  onIndex(i: number): void;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const count = images.length;
  const go = (by: number) => onIndex((index + by + count) % count);

  useEffect(() => {
    const d = dialog.current!;
    d.showModal(); // top layer, focus trap and Esc handling come with <dialog>
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
      if (d.open) d.close();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <dialog
      ref={dialog}
      className="lightbox"
      aria-label="Photo viewer"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Clicks on the backdrop (the dialog itself or the stage around the photo) close it.
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("lightbox-stage")) onClose();
      }}
    >
      <div className="lightbox-top">
        <span className="lightbox-count">
          {index + 1} / {count}
        </span>
        <button className="lightbox-close" onClick={onClose} aria-label="Close" autoFocus>
          ✕
        </button>
      </div>

      <div className="lightbox-stage">
        {count > 1 && (
          <button className="lightbox-nav prev" onClick={() => go(-1)} aria-label="Previous photo">
            ‹
          </button>
        )}
        <Photo key={images[index]} k={images[index]!} size="full" alt={`Photo ${index + 1} of ${count}`} />
        {count > 1 && (
          <button className="lightbox-nav next" onClick={() => go(1)} aria-label="Next photo">
            ›
          </button>
        )}
      </div>

      {count > 1 && (
        <div className="lightbox-thumbs">
          {images.map((k, i) => (
            <button
              key={k}
              className={i === index ? "active" : ""}
              onClick={() => onIndex(i)}
              aria-label={`Photo ${i + 1}`}
              aria-current={i === index}
            >
              <Photo k={k} size="thumb" />
            </button>
          ))}
        </div>
      )}
    </dialog>
  );
}

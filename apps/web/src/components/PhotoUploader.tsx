import { optimizePhoto } from "@jf/shared";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";

/** `onChange` takes an updater because uploads finish asynchronously, after other edits. */
export function PhotoUploader({
  value,
  onChange,
  onBusyChange,
}: {
  value: string[];
  onChange(update: (keys: string[]) => string[]): void;
  /** Told how many photos are still uploading, e.g. to hold back "auto-fill" until they're all in. */
  onBusyChange?(uploading: number): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  useEffect(() => onBusyChange?.(uploading), [uploading, onBusyChange]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function upload(files: FileList | File[]) {
    setError(null);
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    setUploading((n) => n + list.length);
    for (const file of list) {
      try {
        // Downscaled and re-encoded here, so uploads are quick and R2 keeps a small JPEG.
        const blob = await optimizePhoto(file);
        const res = await api<{ key: string }>("/api/images", { body: blob, contentType: blob.type });
        onChange((keys) => [...keys, res.key]);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function move(i: number, by: number) {
    onChange((keys) => {
      const next = [...keys];
      const [k] = next.splice(i, 1);
      next.splice(i + by, 0, k!);
      return next;
    });
  }

  return (
    <div>
      <div
        className={`photos ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files);
        }}
      >
        {value.map((key, i) => (
          <figure key={key} className="photo">
            <img src={`/images/${key}`} alt="" />
            {i === 0 && <span className="cover">Cover</span>}
            <div className="photo-actions">
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move left">
                ←
              </button>
              <button type="button" onClick={() => onChange((keys) => keys.filter((k) => k !== key))} aria-label="Remove">
                ✕
              </button>
              <button
                type="button"
                disabled={i === value.length - 1}
                onClick={() => move(i, 1)}
                aria-label="Move right"
              >
                →
              </button>
            </div>
          </figure>
        ))}
        {Array.from({ length: uploading }, (_, i) => (
          <div key={`u${i}`} className="photo placeholder">
            Uploading…
          </div>
        ))}
        {value.length + uploading < 20 && (
          <button type="button" className="photo add" onClick={() => input.current?.click()}>
            <span>+</span>
            Add photos
            <small className="muted">or drop them here</small>
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = "";
        }}
      />
      {error && <p className="error">{error}</p>}
    </div>
  );
}
